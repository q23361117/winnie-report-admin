import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminSession } from "@/lib/admin-session";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}
function codeOf(value: unknown) {
  const code = String(value ?? "").trim().toUpperCase();
  return code === "059" ? "0059" : code;
}
function customerIdOf(code: string) {
  return createHash("sha256").update(code, "utf8").digest("hex").slice(0, 40);
}
function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }
function legacyNotificationId(customerId: string, balance: number, adjustmentId: string) {
  return sha(`reconcile-notice-v1:${customerId}:${balance}:${adjustmentId}`);
}
const formatMoney = (value: number) => `NT$${value.toLocaleString("zh-TW")}`;
const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${formatMoney(value)}`;

type LedgerItem = {
  id: string; before: number; after: number; delta: number;
  type: string; summary: string; createdAtMs: number;
};
type NoticeItem = {
  id: string; balance: number; status: string; createdAtMs: number;
};
type CustomerSnapshot = {
  customerId: string; code: string; name: string; balance: number; lineUserId: string;
  adjustmentId: string; previousBalance: number | null; changeAmount: number | null;
  noticeId: string; message: string;
  ledgerIds: string[];
};
function getTimeMs(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const data = value as { toMillis?: () => number; seconds?: number };
  if (typeof data.toMillis === "function") return data.toMillis();
  return typeof data.seconds === "number" ? data.seconds * 1000 : 0;
}
function summaryOf(data: Record<string, unknown>): string {
  const type = String(data.type ?? "");
  const source = String(data.source ?? "");
  const label = type === "payment" ? "收款入帳" : type === "deposit" ? "儲值入帳" :
    type === "adjustment" ? "手動扣款" :
    source === "google_sheets_report" ? (Number(data.paymentAmount || 0) > 0 ? "報表收款" : "後結車資") : "帳務調整";
  const reason = String(data.reason ?? data.orderContent ?? data.plate ?? "").replace(/\s+/g, " ").trim().slice(0, 110);
  return reason ? `${label}（${reason}）` : label;
}

/**
 * 只在「有前次已受理通知」且「其後的完整交易鏈可以從前餘額接到目前餘額」時展示明細。
 * 無法證實完整，不使用月報差額或隨意加總交易來杜撰更正金額。
 * 只讀取，不會寫帳、補扣或修改點數。
 */
async function verifiedChanges(customerId: string, balance: number): Promise<{
  chain: { before: number; items: LedgerItem[]; latestId: string } | null;
  priorSameBalanceNoticeId: string | null;
}> {
  const [ledgerSnap, noticeSnap] = await Promise.all([
    adminDb.collection("postpaidTransactions").where("customerId", "==", customerId).limit(250).get(),
    adminDb.collection("postpaidReconcileNotices").where("customerId", "==", customerId).limit(150).get(),
  ]);
  // 查詢達上限，可能遺漏交易；保守降級成餘額通知。
  if (ledgerSnap.size >= 250 || noticeSnap.size >= 150) return { chain: null, priorSameBalanceNoticeId: null };
  const notices: NoticeItem[] = noticeSnap.docs.map(doc => {
    const d = doc.data();
    return { id: doc.id, balance: Number(d.balance), status: String(d.status ?? ""), createdAtMs: getTimeMs(d.createdAt) };
  }).filter(n => (n.status === "accepted" || n.status === "sending" || n.status === "unknown") && Number.isSafeInteger(n.balance) && n.createdAtMs > 0)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
  if (!notices.length) return { chain: null, priorSameBalanceNoticeId: null };
  const anchor = notices[0];
  if (anchor.balance === balance) return { chain: null, priorSameBalanceNoticeId: anchor.id };

  const items: LedgerItem[] = ledgerSnap.docs.flatMap(doc => {
    const d = doc.data();
    if (d.status === "reversed" || d.status === "void") return [];
    const before = Number(d.previousBalance);
    const after = Number(d.newBalance);
    const timestamp = getTimeMs(d.createdAt);
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || !timestamp || timestamp < anchor.createdAtMs) return [];
    const delta = after - before;
    if (!Number.isSafeInteger(delta) || delta === 0) return [];
    const amount = Number(d.amount);
    if (Number.isSafeInteger(amount) && amount !== delta) return [];
    return [{ id: doc.id, before, after, delta, type: String(d.type ?? ""), summary: summaryOf(d), createdAtMs: timestamp }];
  }).sort((a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id));

  const chain: LedgerItem[] = [];
  let expected = balance;
  let upperTime = Number.POSITIVE_INFINITY;
  // 由目前餘額往回推，只接受唯一的連續餘額鏈。
  for (let i = 0; i < 20 && expected !== anchor.balance; i++) {
    const matched = items.filter(t => t.after === expected && t.createdAtMs <= upperTime && !chain.some(c => c.id === t.id));
    if (matched.length !== 1) return { chain: null, priorSameBalanceNoticeId: null };
    const item = matched[0];
    chain.push(item);
    expected = item.before;
    upperTime = item.createdAtMs;
  }
  if (expected !== anchor.balance || !chain.length) return { chain: null, priorSameBalanceNoticeId: null };
  const ordered = chain.reverse();
  if (ordered.reduce((sum, item) => sum + item.delta, anchor.balance) !== balance) return { chain: null, priorSameBalanceNoticeId: null };
  return { chain: { before: anchor.balance, items: ordered, latestId: ordered[ordered.length - 1].id }, priorSameBalanceNoticeId: null };
}

async function readSnapshot(rawCode: unknown): Promise<CustomerSnapshot> {
  const code = codeOf(rawCode);
  if (!/^(?:\d{3,8}|[\p{L}][\p{L}\d_-]{0,19})$/u.test(code)) throw new Error("客戶代號格式不正確");
  const customerId = customerIdOf(code);
  const doc = await adminDb.collection("postpaidCustomers").doc(customerId).get();
  if (!doc.exists) throw new Error(`找不到客戶 ${code}`);
  const data = doc.data() || {};
  if (codeOf(data.customerCode) !== code) throw new Error("客戶主檔代號不符");
  if (data.status !== "active") throw new Error("客戶不是啟用狀態");
  const balance = data.balance;
  if (!Number.isSafeInteger(balance)) throw new Error("客戶餘額不是有效整數，禁止通知");
  const lineUserId = String(data.lineUserId ?? "").trim();
  if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) throw new Error("客戶尚未綁定有效的 LINE User ID");
  const name = String(data.name || code).trim().slice(0, 60);
  const adjustmentId = String(data.lastBalanceAdjustmentId || "").trim();
  let previousBalance: number | null = null;
  let changeAmount: number | null = null;
  if (adjustmentId) {
    const adjustment = await adminDb.collection("postpaidBalanceAdjustments").doc(adjustmentId).get();
    const a = adjustment.data() || {};
    if (adjustment.exists && a.status === "committed" && a.customerId === customerId &&
      a.targetBalance === balance && Number.isSafeInteger(a.previousBalance) && Number.isSafeInteger(a.delta) &&
      a.previousBalance + a.delta === balance) {
      previousBalance = a.previousBalance;
      changeAmount = a.delta;
    }
  }
  let chain: { before: number; items: LedgerItem[]; latestId: string } | null = null;
  let priorSameBalanceNoticeId: string | null = null;
  try {
    const verification = await verifiedChanges(customerId, balance);
    chain = verification.chain; priorSameBalanceNoticeId = verification.priorSameBalanceNoticeId;
  }
  catch (e) { console.warn("通知逐筆明細無法完整驗證，改只顯示最新餘額：", e instanceof Error ? e.message : String(e)); }

  const ledgerIds = chain?.items.map(i => i.id) ?? [];
  // 已有相同餘額的舊版通知時，仍沿用舊 ID，避免新版造成重發。
  const legacyId = legacyNotificationId(customerId, balance, previousBalance === null ? "balance-confirmation" : adjustmentId);
  const legacy = await adminDb.collection("postpaidReconcileNotices").doc(legacyId).get();
  const noticeId = priorSameBalanceNoticeId || (legacy.exists ? legacyId : chain ? sha(`reconcile-notice-v2:${customerId}:${balance}:${ledgerIds.join("|")}`) : legacyId);
  const header = chain || previousBalance !== null ? "📘【維尼車隊｜後結帳務更正通知】" : "📘【維尼車隊｜後結帳務核對結果】";
  const lines = [header, "", `👤 客戶代號：${code}`, `👤 客戶名稱：${name}`, "", "📋 經管理員逐筆核對，提供本次確認的後結餘額。", ""];
  if (chain) {
    lines.push(`💰 更正前餘額：${formatMoney(chain.before)}`, "", "📑 本次已登記交易：");
    chain.items.forEach((item, idx) => lines.push(`${idx + 1}. ${item.summary}：${signedMoney(item.delta)}`));
    lines.push("", `🧾 本次淨調整：${signedMoney(balance - chain.before)}`, `📊 更正後餘額：${formatMoney(balance)}`);
  } else if (previousBalance !== null && changeAmount !== null) {
    lines.push(`💰 更正前餘額：${formatMoney(previousBalance)}`, `🧾 本次調整：${signedMoney(changeAmount)}`, `📊 更正後餘額：${formatMoney(balance)}`);
  } else {
    lines.push(`📊 本次核對餘額：${formatMoney(balance)}`);
  }
  lines.push("", "負數代表尚欠車資；正數代表帳戶尚有餘額。", "此訊息為已核對帳務結果通知，不會另外扣款或新增搭乘紀錄。", "如與您的紀錄不同，請聯繫車隊客服協助核對。感謝您的理解與配合。");
  const message = lines.join("\n");
  if (message.length > 4500) throw new Error("通知文字過長，請縮小待核對交易範圍");
  return { customerId, code, name, balance, lineUserId, adjustmentId, previousBalance, changeAmount, noticeId, message, ledgerIds };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("禁止跨站請求", 403);
  const admin = await getAdminSession();
  if (!admin) return fail("管理員登入已失效", 401);
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("JSON 格式錯誤", 400);
    body = raw as Record<string, unknown>;
  } catch { return fail("JSON 格式錯誤", 400); }
  const action = String(body.action ?? "");
  if (action !== "preview" && action !== "send") return fail("未知操作", 400);
  let snapshot: CustomerSnapshot;
  try { snapshot = await readSnapshot(body.customerCode); }
  catch (e) { return fail(e instanceof Error ? e.message : "無法讀取客戶", 400); }

  const noticeRef = adminDb.collection("postpaidReconcileNotices").doc(snapshot.noticeId);
  if (action === "preview") {
    const prior = await noticeRef.get();
    return NextResponse.json({ success: true, customerCode: snapshot.code, customerName: snapshot.name,
      currentBalance: snapshot.balance, noticeId: snapshot.noticeId, message: snapshot.message,
      priorStatus: prior.exists ? String(prior.data()?.status || "unknown") : "not_sent" },
      { headers: { "Cache-Control": "no-store" } });
  }

  if (process.env.WINNIE_RECONCILE_NOTIFY_ENABLED !== "true") return fail("通知功能未啟用，請設定 WINNIE_RECONCILE_NOTIFY_ENABLED=true", 423);
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) return fail("Vercel 缺少 LINE_CHANNEL_ACCESS_TOKEN", 423);
  if (body.noticeId !== snapshot.noticeId) return fail("客戶餘額或通知明細已改變，請重新預覽", 409);
  if (body.confirmation !== `確認通知${snapshot.code}`) return fail(`請輸入「確認通知${snapshot.code}」`, 400);
  if (body.confirmed !== true) return fail("請先勾選人工核對已完成", 400);
  const evidence = String(body.evidence ?? "").trim();
  if (evidence.length < 12 || evidence.length > 500) return fail("請填入 12～500 字人工核對依據", 400);
  try {
    await adminDb.runTransaction(async tx => {
      const customerRef = adminDb.collection("postpaidCustomers").doc(snapshot.customerId);
      const [customer, existing] = await Promise.all([tx.get(customerRef), tx.get(noticeRef)]);
      if (existing.exists) throw new Error("此餘額已有通知紀錄（包含發送狀態不明），禁止重複發送");
      const live = customer.data() || {};
      if (!customer.exists || live.balance !== snapshot.balance ||
          String(live.lastBalanceAdjustmentId || "") !== snapshot.adjustmentId ||
          String(live.lineUserId || "").trim() !== snapshot.lineUserId) {
        throw new Error("客戶資料在確認期間已改變，請重新預覽");
      }
      tx.create(noticeRef, {
        customerId: snapshot.customerId, customerCode: snapshot.code, balance: snapshot.balance,
        adjustmentId: snapshot.adjustmentId, ledgerIds: snapshot.ledgerIds, message: snapshot.message,
        evidence, actorUid: admin.uid, status: "sending", createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) { return fail(e instanceof Error ? e.message : "已有發送紀錄", 409); }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: snapshot.lineUserId, messages: [{ type: "text", text: snapshot.message }] }),
      cache: "no-store", signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      await noticeRef.update({ status: "rejected", lineHttpStatus: response.status, lineError: detail, updatedAt: FieldValue.serverTimestamp() });
      return fail(`LINE API 拒絕 (${response.status})，請查看 Vercel Logs；本筆不會自動重送`, 502);
    }
    await noticeRef.update({ status: "accepted", lineHttpStatus: response.status, acceptedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ success: true, status: "accepted", message: "LINE API 已接受推播請求，請確認客人實際收到訊息" },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    try { await noticeRef.update({ status: "unknown", lastError: e instanceof Error ? e.message : String(e), updatedAt: FieldValue.serverTimestamp() }); } catch { /* 發送結果不明時同樣禁止重送 */ }
    return fail("LINE 發送結果不明，為防止重複通知已鎖定該筆；請查 LINE／Vercel 記錄", 502);
  }
}
