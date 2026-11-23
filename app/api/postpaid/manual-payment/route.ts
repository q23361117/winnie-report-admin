import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminSession } from "@/lib/admin-session";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  // 不允許第三方網站直接透過管理員 Cookie 發起記帳要求。
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply("禁止跨站請求", 403);
  const admin = await getAdminSession();
  if (!admin) return reply("管理員登入已失效，請先重新登入後結後台", 401);

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply("請求資料格式錯誤");
    payload = parsed as Record<string, unknown>;
  } catch { return reply("請提供有效的 JSON"); }

  const customerId = String(payload.customerId ?? "").trim();
  const customerCode = String(payload.customerCode ?? "").trim().toUpperCase();
  const type = String(payload.type ?? "");
  const amount = payload.amount;
  const expectedBalance = payload.expectedBalance;
  const reason = String(payload.reason ?? "").trim().replace(/\s+/g, " ");
  if (!/^[a-f0-9]{40}$/i.test(customerId)) return reply("客戶主檔識別碼格式錯誤");
  if (!/^(?:\d{3,8}|[\p{L}][\p{L}\d_-]{0,19})$/u.test(customerCode)) return reply("客戶代號格式錯誤");
  if (!["payment", "deposit", "adjustment"].includes(type)) return reply("未知的帳務類型");
  if (!Number.isSafeInteger(amount) || Number(amount) <= 0 || Number(amount) > 1000000) return reply("金額必須是 1～1,000,000 元整數");
  if (!Number.isSafeInteger(expectedBalance)) return reply("請重新讀取最新餘額再操作");
  if (reason.length < 12 || reason.length > 500) return reply("原因請輸入 12～500 字，包含實際日期、收款方式或憑證編號");

  // 同一客戶、類型、金額、收款描述會得到固定 ID，重新整理或網路逾時均不能再入帳。
  // 不同日期的相同金額收款，務必記錄不同的日期／收款憑證。
  const fingerprint = `${customerId}|${type}|${amount}|${reason}`;
  const transactionId = `manual_v1_${createHash("sha256").update(fingerprint).digest("hex")}`;
  const customerRef = adminDb.collection("postpaidCustomers").doc(customerId);
  const transactionRef = adminDb.collection("postpaidTransactions").doc(transactionId);

  try {
    const result = await adminDb.runTransaction(async tx => {
      const [customerSnap, previousTxn] = await Promise.all([tx.get(customerRef), tx.get(transactionRef)]);
      if (previousTxn.exists) {
        const prior = previousTxn.data() || {};
        if (prior.customerCode !== customerCode || prior.type !== type || prior.inputAmount !== amount) {
          throw new Error("收款識別碼已被其他交易使用，拒絕寫入");
        }
        return { duplicated: true, previousBalance: prior.previousBalance, newBalance: prior.newBalance, transactionId };
      }
      if (!customerSnap.exists) throw new Error("找不到後結客戶");
      const data = customerSnap.data() || {};
      if (String(data.customerCode ?? "").trim().toUpperCase() !== customerCode) throw new Error("客戶代號與帳本不相符，請重新整理");
      if (data.status !== "active") throw new Error("客戶非啟用狀態");
      const current = data.balance;
      if (!Number.isSafeInteger(current) || current !== expectedBalance) throw new Error(`帳戶餘額已改變（目前 ${String(current)} 元），請重新整理，不要直接重送`);
      const delta = type === "adjustment" ? -Number(amount) : Number(amount);
      const newBalance = current + delta;
      if (!Number.isSafeInteger(newBalance)) throw new Error("計算後餘額超出安全範圍");
      tx.create(transactionRef, {
        transactionId, customerCode, customerName: String(data.name ?? customerCode),
        customerId, type, amount: delta, inputAmount: amount, previousBalance: current,
        newBalance, status: "active", reason, source: "admin_manual_server_v1",
        chargeAmount: 0, paymentAmount: type === "payment" || type === "deposit" ? amount : 0,
        actorUid: admin.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(customerRef, { balance: newBalance, updatedAt: FieldValue.serverTimestamp() });
      return { duplicated: false, previousBalance: current, newBalance, transactionId };
    });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "帳務寫入失敗";
    console.error("後結手動入帳失敗：", message);
    return reply(message, 409);
  }
}
