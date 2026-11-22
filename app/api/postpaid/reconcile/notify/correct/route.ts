import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminSession } from "@/lib/admin-session";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// V2 安全補登：只針對已人工核對的 0059，2026/11/20 第 208、209 列。
// 未查證的其他交易仍透過既有一鍵對帳流程處理。
const CORRECTION = {
  customerCode: "0059",
  previousBalance: -2442,
  amount: 1370,
  targetBalance: -3812,
  date: "2026-11-20",
  lines: [{ row: 208, amount: 850 }, { row: 209, amount: 520 }],
  sourceKey: "sheet:2026-11:0:rows:208,209:2026-11-20:0059:1370",
};
const customerId = createHash("sha256").update(CORRECTION.customerCode, "utf8").digest("hex").slice(0, 40);
const operationId = createHash("sha256").update(`postpaid-confirmed-backfill-v2:${CORRECTION.sourceKey}`).digest("hex");

function response(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return response({ success: false, error: "禁止跨站請求" }, 403);
  const admin = await getAdminSession();
  if (!admin) return response({ success: false, error: "請先登入管理員" }, 401);
  if (process.env.WINNIE_RECONCILE_WRITE_ENABLED !== "true") {
    return response({ success: false, error: "請先啟用既有 WINNIE_RECONCILE_WRITE_ENABLED=true" }, 423);
  }
  let body: Record<string, unknown>;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("bad request");
    body = input as Record<string, unknown>;
  } catch { return response({ success: false, error: "請提供有效 JSON" }, 400); }
  const evidence = String(body.evidence ?? "").trim();
  if (body.customerCode !== "0059" || body.confirmation !== "確認補登0059" || body.confirmed !== true) {
    return response({ success: false, error: "請完成 0059 人工核對確認" }, 400);
  }
  if (evidence.length < 12 || evidence.length > 500) return response({ success: false, error: "請填寫 12～500 字人工核對依據" }, 400);
  if (body.expectedBalance !== CORRECTION.previousBalance) {
    return response({ success: false, error: "帳務頁餘額不是核對時的 -2442，請重新查帳，不能直接補登" }, 409);
  }
  const customerRef = adminDb.collection("postpaidCustomers").doc(customerId);
  const correctionRef = adminDb.collection("postpaidBalanceAdjustments").doc(operationId);
  try {
    const result = await adminDb.runTransaction(async tx => {
      const [customer, existing] = await Promise.all([tx.get(customerRef), tx.get(correctionRef)]);
      if (existing.exists) throw new Error("11/20 第208、209列已建立過補登紀錄，禁止重複扣款");
      if (!customer.exists) throw new Error("0059 客戶主檔不存在");
      const data = customer.data() || {};
      if (String(data.customerCode || "").trim() !== "0059" || data.status !== "active") throw new Error("客戶代號或狀態不符合");
      if (!Number.isSafeInteger(data.balance) || data.balance !== CORRECTION.previousBalance) {
        throw new Error(`帳本餘額已變更（目前 ${String(data.balance)}），請重新核對，拒絕補登`);
      }
      const reason = `2026/11/20 0059 後結漏帳：11月維尼報表第208列850元、第209列520元，合計1370元。${evidence}`;
      tx.create(correctionRef, {
        operationId, sourceKey: CORRECTION.sourceKey, sourceMonth: "2026-11", sourceSheet: "⚖️維尼", sourceRows: [208, 209],
        type: "manual_reconciliation_adjustment", customerId, customerCode: "0059",
        previousBalance: CORRECTION.previousBalance, targetBalance: CORRECTION.targetBalance, delta: -CORRECTION.amount,
        reason, evidence, actorUid: admin.uid, status: "committed", createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(customerRef, {
        balance: CORRECTION.targetBalance,
        lastBalanceAdjustmentId: operationId,
        lastBalanceAdjustmentAmount: -CORRECTION.amount,
        lastBalanceAdjustmentReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { success: true, customerCode: "0059", previousBalance: CORRECTION.previousBalance,
        delta: -CORRECTION.amount, newBalance: CORRECTION.targetBalance, operationId,
        message: "0059 已補登 11/20 兩筆漏帳；請再次核對帳本並確認 LINE 預覽後才發送" };
    });
    return response(result);
  } catch (error) {
    return response({ success: false, error: error instanceof Error ? error.message : "補登失敗" }, 409);
  }
}
