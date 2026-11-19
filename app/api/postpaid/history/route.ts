import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getAdminSession } from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const LIMIT = 350;
const headers = { "Cache-Control": "private, no-store" };
function response(data: object, status = 200) {
  return NextResponse.json(data, { status, headers });
}
function num(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function millis(v: unknown): number | null {
  if (v && typeof v === "object" && "toMillis" in v && typeof v.toMillis === "function") {
    const n = v.toMillis(); return typeof n === "number" && Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string") { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function convert(id: string, d: Record<string, unknown>, adjustment = false) {
  const charge = num(d.chargeAmount), payment = num(d.paymentAmount);
  return {
    id: adjustment ? `reconcile:${id}` : id,
    customerCode: str(d.customerCode),
    type: adjustment ? "manual_reconciliation_adjustment" : str(d.type),
    status: adjustment && d.status === "committed" ? "active" : str(d.status) || "active",
    amount: adjustment ? num(d.delta) : num(d.amount) ?? num(d.netChange) ?? (charge !== null || payment !== null ? (payment ?? 0) - (charge ?? 0) : null),
    previousBalance: num(d.previousBalance),
    newBalance: num(adjustment ? d.targetBalance : d.newBalance),
    reason: str(d.reason), rideDate: str(d.rideDate), orderContent: str(d.orderContent),
    source: adjustment ? "postpaidBalanceAdjustments" : str(d.source),
    chargeAmount: charge, paymentAmount: payment, createdAtMs: millis(d.createdAt),
  };
}
export async function GET(request: NextRequest) {
  if (!(await getAdminSession())) return response({ success:false, error:"請重新登入管理員帳號" },401);
  const id = request.nextUrl.searchParams.get("customerId") || "";
  if (!id || id.length > 100 || id.includes("/") || id === "." || id === "..") return response({success:false,error:"客戶識別碼不正確"},400);
  try {
    const customer = await adminDb.collection("postpaidCustomers").doc(id).get();
    if (!customer.exists) return response({success:false,error:"找不到後結客戶"},404);
    const code = str(customer.data()?.customerCode).trim();
    if (!code) return response({success:false,error:"客戶代號缺失"},409);
    const codes = [code];
    const warnings: string[] = [];
    // 與一鍵對帳一致，只對已知的 0059 舊代號作相容查詢。
    if (code === "0059") {
      const aliasOwner = await adminDb.collection("postpaidCustomers").where("customerCode","==","059").limit(1).get();
      if (aliasOwner.empty) { codes.push("059"); warnings.push("含舊代號 059 的帳務，請核對是否為同一客戶。"); }
      else warnings.push("059 有獨立客戶主檔，本次未合併其交易。");
    }
    const rows = new Map<string, ReturnType<typeof convert>>();
    for (const lookup of codes) {
      const snap = await adminDb.collection("postpaidTransactions").where("customerCode","==",lookup).limit(LIMIT+1).get();
      if (snap.size > LIMIT) return response({success:false,error:`代號 ${lookup} 超過 ${LIMIT} 筆查詢上限，需分頁查詢；未顯示不完整帳本。`},409);
      for (const doc of snap.docs) rows.set(doc.id,convert(doc.id,doc.data()));
    }
    const adjustments = await adminDb.collection("postpaidBalanceAdjustments").where("customerId","==",id).limit(LIMIT+1).get();
    if (adjustments.size > LIMIT) return response({success:false,error:"人工更正紀錄超過查詢上限，需分頁查詢。"},409);
    for (const doc of adjustments.docs) rows.set(`reconcile:${doc.id}`,convert(doc.id,doc.data(),true));
    const transactions = [...rows.values()].sort((a,b)=>(b.createdAtMs ?? 0)-(a.createdAtMs ?? 0)||a.id.localeCompare(b.id));
    return response({success:true,transactions,warning:warnings.join(" ")});
  } catch (err) {
    console.error("後結歷史帳務查詢失敗",err);
    return response({success:false,error:"後台讀取帳務失敗，請檢查 Vercel Runtime Logs（可能為 Firebase 權限或查詢錯誤）。"},500);
  }
}
