import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminSession } from "@/lib/admin-session";
import { adminDb } from "@/lib/firebase-admin";
import { reconcilePostpaid, SCAN_MONTHS, type ReportMonth, type ReconcileEntry } from "@/lib/postpaid-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Input = { action?: string; customerCode?: string; months?: unknown; keys?: unknown; expectedBalance?: unknown;
  evidence?: unknown; confirmed?: unknown; confirmation?: unknown; legacyReviewed?: unknown };
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const canonical = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/^059$/, "0059");
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
const claimId = (row: ReconcileEntry) => sha(`postpaid-backfill-v3:${row.month}:${row.sheet}:${row.row}:${canonical(row.code)}`);
const money = (n: unknown) => Number.isSafeInteger(n) ? Number(n) : NaN;
const norm = (v: unknown) => String(v ?? "").replace(/\s/g, "").toLowerCase();

async function audit(code: string, months: ReportMonth[]) {
  const report = await reconcilePostpaid(months);
  const account = report.accounts.find(a => canonical(a.code) === code);
  if (!account || !account.firestoreCustomerId || account.currentBalance === null || account.hasTruncatedLedger || account.status === "INCOMPLETE") {
    throw new Error("該客戶無法完成安全核對：主檔不存在或帳本讀取不完整");
  }
  const customerId = sha(code).slice(0, 40);
  if (account.firestoreCustomerId !== customerId) throw new Error("客戶主檔 ID 不符合，請先核對客戶代號");
  const customerSnap = await adminDb.collection("postpaidCustomers").doc(customerId).get();
  const data = customerSnap.data() || {};
  if (!customerSnap.exists || canonical(data.customerCode) !== code || data.status !== "active" || !Number.isSafeInteger(data.balance)) {
    throw new Error("客戶主檔已改變，無法核對");
  }
  // 已確認的歷史補登和先前人工調整，需要在畫面明示，不把月總差異直接當成漏帳。
  const oldAdjustments = await adminDb.collection("postpaidBalanceAdjustments").where("customerId", "==", customerId).limit(200).get();
  const adjustments = oldAdjustments.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));
  const historicalRows = new Set<string>();
  for (const a of adjustments) {
    if (a.status !== "committed") continue;
    const m = String(a.sourceMonth || "");
    const sheet = String(a.sourceSheet || "⚖️維尼");
    if (Array.isArray(a.sourceRows)) for (const r of a.sourceRows) {
      if (Number.isInteger(r)) historicalRows.add(`${m}:${sheet}:${r}`);
    }
  }
  // 只做可驗證的精確來源匹配。無來源 ID 的歷史調整仍需人工逐筆判斷。
  const ledgers = await Promise.all((code === "0059" ? ["0059", "059"] : [code]).map(c =>
    adminDb.collection("postpaidTransactions").where("customerCode", "==", c).limit(350).get()));
  const ledger = ledgers.flatMap(q => q.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>)));
  const candidates = account.rows.filter(r => r.charge > 0 && r.payment === 0).slice(0, 350);
  const claims = candidates.length ? await adminDb.getAll(...candidates.map(r => adminDb.collection("postpaidReconcileBackfillClaims").doc(claimId(r)))) : [];
  const rows = candidates.map((r, i) => {
    const source = `${r.month}:${r.sheet}:${r.row}`;
    const inLedger = ledger.some(l => {
      if (l.status === "reversed") return false;
      const id = String(l.sourceKey || l.reportKey || l.sheetKey || "");
      const rowNo = Number(l.sourceRow ?? l.sheetRow ?? l.reportRow ?? l.rowNumber);
      const matchSource = id === source || (rowNo === r.row && String(l.rideDate || "").startsWith(r.month) &&
        (!l.sourceSheet || String(l.sourceSheet) === r.sheet));
      return matchSource && Number(l.chargeAmount) === r.charge;
    });
    const blocked = claims[i].exists || historicalRows.has(source) || inLedger;
    return { key: r.key, month: r.month, sheet: r.sheet, row: r.row, date: r.date,
      order: r.order, charge: r.charge, status: blocked ? "already_recorded" : "manual_review_required",
      reason: claims[i].exists ? "V3 已補登" : historicalRows.has(source) ? "既有人工補登含此來源列" : inLedger ? "帳本有符合來源紀錄" : "未找到可精確匹配的來源；可能已包含在舊人工更正" };
  });
  return { account, rows, customerId, manualAdjustmentCount: adjustments.length,
    adjustmentReadTruncated: oldAdjustments.size >= 200, ledgerReadTruncated: ledgers.some(x=>x.size >= 350) };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("禁止跨站操作", 403);
  const admin = await getAdminSession();
  if (!admin) return fail("管理員登入已失效", 401);
  let body: Input;
  try { body = await request.json() as Input; } catch { return fail("JSON 格式錯誤"); }
  const code = canonical(body.customerCode);
  if (!/^(?:\d{3,8}|[\p{L}][\p{L}\d_-]{0,19})$/u.test(code)) return fail("客戶代號不正確");
  const months = body.months;
  if (!Array.isArray(months) || months.length < 1 || months.length > 2 ||
      months.some(m => !SCAN_MONTHS.includes(m as ReportMonth)) || new Set(months).size !== months.length) return fail("月份不正確");
  if (!(["candidates", "correct"] as unknown[]).includes(body.action)) return fail("未知操作");
  try {
    const checked = await audit(code, months as ReportMonth[]);
    if (body.action === "candidates") return NextResponse.json({success:true, code, balance:checked.account.currentBalance,
      rows:checked.rows, manualAdjustmentCount: checked.manualAdjustmentCount,
      needsExtraReview:checked.adjustmentReadTruncated || checked.ledgerReadTruncated,
      warning:"來源列與既有人工更正可能重疊，未找到精確來源不表示確定漏帳。必須人工逐筆核對。"}, {headers:{"Cache-Control":"no-store"}});
    if (process.env.WINNIE_RECONCILE_WRITE_ENABLED !== "true") return fail("後結帳務更正權限未開啟", 423);
    if (checked.adjustmentReadTruncated || checked.ledgerReadTruncated) return fail("既有帳務查詢達上限，請先人工縮小查核範圍", 409);
    const keys = body.keys;
    if (!Array.isArray(keys) || !keys.length || keys.length > 10 || keys.some(k => typeof k !== "string") || new Set(keys).size !== keys.length) return fail("每次請勾選 1～10 筆不同的漏帳");
    const selected = keys.map(k => checked.rows.find(r=>r.key===k));
    if (selected.some(r => !r || r.status !== "manual_review_required")) return fail("包含已入帳、重複或已變動的訂單，請重新掃描",409);
    const evidence = String(body.evidence || "").trim();
    if (evidence.length < 20 || evidence.length > 500 || body.confirmed !== true || body.legacyReviewed !== true || body.confirmation !== `確認補登${code}`) return fail("請逐筆核對人工更正、填寫至少20字依據並完成確認");
    const oldBalance = money(body.expectedBalance);
    if (!Number.isSafeInteger(oldBalance) || oldBalance !== checked.account.currentBalance) return fail("核對期間餘額已改變，請重新查帳",409);
    const items = selected.filter((r):r is NonNullable<typeof r> => Boolean(r));
    const amount = items.reduce((sum,r)=>sum+r.charge,0);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) return fail("補登金額超過安全範圍");
    const target = oldBalance - amount;
    const keyHash = sha(items.map(x=>x.key).sort().join("|"));
    const operationId = sha(`postpaid-v3-correction:${code}:${keyHash}`);
    const result = await adminDb.runTransaction(async tx=>{
      const customerRef = adminDb.collection("postpaidCustomers").doc(checked.customerId);
      const correctionRef = adminDb.collection("postpaidBalanceAdjustments").doc(operationId);
      const claimRefs = items.map(r => adminDb.collection("postpaidReconcileBackfillClaims").doc(sha(`postpaid-backfill-v3:${r.month}:${r.sheet}:${r.row}:${code}`)));
      const [customer, correction, ...claims] = await Promise.all([tx.get(customerRef),tx.get(correctionRef),...claimRefs.map(r=>tx.get(r))]);
      if (correction.exists || claims.some(s=>s.exists)) throw new Error("已有相同來源補登紀錄，禁止再次扣款");
      if (!customer.exists || Number(customer.data()?.balance)!==oldBalance || canonical(customer.data()?.customerCode)!==code || customer.data()?.status!=="active") throw new Error("帳本餘額或客戶狀態已改變，請重新核對");
      tx.create(correctionRef,{operationId,type:"manual_reconciliation_adjustment",customerId:checked.customerId,customerCode:code,
        previousBalance:oldBalance,targetBalance:target,delta:-amount,sourceKeys:items.map(r=>r.key),sourceRows:items.map(r=>r.row),
        sourceItems:items.map(r=>({key:r.key,month:r.month,sheet:r.sheet,row:r.row,date:r.date,order:r.order,charge:r.charge})),
        reason:evidence,evidence,actorUid:admin.uid,status:"committed",createdAt:FieldValue.serverTimestamp()});
      claimRefs.forEach((ref,i)=>tx.create(ref,{customerId:checked.customerId,customerCode:code,sourceKey:items[i].key,
        operationId,amount:items[i].charge,createdAt:FieldValue.serverTimestamp()}));
      tx.update(customerRef,{balance:target,lastBalanceAdjustmentId:operationId,lastBalanceAdjustmentAmount:-amount,
        lastBalanceAdjustmentReason:evidence,updatedAt:FieldValue.serverTimestamp()});
      return {success:true,customerCode:code,previousBalance:oldBalance,delta:-amount,newBalance:target,operationId,
        message:"補登完成。請重新載入 LINE 預覽，核對正確餘額後再通知客人（本次不會自動推播）"};
    });
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch(e) {return fail(e instanceof Error?e.message:"核對或補登失敗",409);}
}
