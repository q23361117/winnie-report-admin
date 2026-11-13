import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminSession } from "@/lib/admin-session";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * 人工更正餘額，只能對「已存在、已核對」的後結客戶執行。
 * 不會重放整份報表、不改歷史交易、也不發 LINE。
 * 預設不開啟：必須在部署環境設置 WINNIE_RECONCILE_WRITE_ENABLED=true。
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return failed("禁止跨站請求", 403);
  const admin = await getAdminSession();
  if (!admin) return failed("管理員登入已失效", 401);
  if (process.env.WINNIE_RECONCILE_WRITE_ENABLED !== "true") {
    return failed("正式餘額更正尚未開放，請先完成對帳、備份，再設定 WINNIE_RECONCILE_WRITE_ENABLED=true", 423);
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return failed("資料格式錯誤", 400);
    body = parsed as Record<string, unknown>;
  } catch { return failed("請提供有效 JSON", 400); }

  const customerCode = String(body.customerCode || "").trim().toUpperCase();
  const customerId = String(body.customerId || "").trim();
  const reason = String(body.reason || "").trim();
  const expectedBalance = body.expectedBalance;
  const targetBalance = body.targetBalance;
  const operationId = String(body.operationId || "").trim();
  const confirmation = String(body.confirmation || "").trim();
  if (!customerId || !customerCode || customerId.includes("/") || customerId.length > 100) return failed("客戶識別碼不正確", 400);
  if (!Number.isSafeInteger(expectedBalance) || !Number.isSafeInteger(targetBalance) ||
    Math.abs(expectedBalance as number) > 100000000 || Math.abs(targetBalance as number) > 100000000) return failed("餘額須為有效整數", 400);
  if (reason.length < 12 || reason.length > 500) return failed("請填寫至少 12 個字的核對依據（日期、報表金額與收款證明）", 400);
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return failed("更正操作識別碼不正確", 400);
  if (confirmation !== `確認更正${customerCode}`) return failed(`請輸入「確認更正${customerCode}」`, 400);
  if (expectedBalance === targetBalance) return failed("餘額沒有差異，不需建立更正交易", 400);
  const customerRef = adminDb.collection("postpaidCustomers").doc(customerId);
  const adjustmentRef = adminDb.collection("postpaidBalanceAdjustments").doc(operationId);
  try {
    const value = await adminDb.runTransaction(async (tx) => {
      const [current, existing] = await Promise.all([tx.get(customerRef), tx.get(adjustmentRef)]);
      if (existing.exists) {
        const e = existing.data() || {};
        if (e.customerId !== customerId || e.targetBalance !== targetBalance) throw new Error("操作識別碼已用於其他調整");
        return { duplicated: true, previousBalance: e.previousBalance, newBalance: e.targetBalance };
      }
      if (!current.exists) throw new Error("找不到客戶主檔，不可建立新客戶或修改其他帳戶");
      const data = current.data() || {};
      if (String(data.customerCode || "").trim().toUpperCase() !== customerCode) throw new Error("客戶代號與主檔不一致，拒絕更正");
      if (data.status !== "active") throw new Error("客戶不是啟用狀態");
      const oldBalance = Number(data.balance);
      if (!Number.isSafeInteger(oldBalance)) throw new Error("目前餘額非有效整數，請人工核查");
      if (oldBalance !== expectedBalance) throw new Error(`餘額在確認期間已改變：目前為 ${oldBalance}，請重新掃描`);
      const delta = (targetBalance as number) - oldBalance;
      tx.create(adjustmentRef, {
        operationId, customerId, customerCode, type: "manual_reconciliation_adjustment",
        previousBalance: oldBalance, targetBalance, delta, reason,
        actorUid: admin.uid, status: "committed", createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(customerRef, {
        balance: targetBalance, lastBalanceAdjustmentId: operationId,
        lastBalanceAdjustmentAmount: delta, lastBalanceAdjustmentReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { duplicated: false, previousBalance: oldBalance, newBalance: targetBalance };
    });
    return NextResponse.json({ success: true, ...value });
  } catch (error) {
    const message = error instanceof Error ? error.message : "寫入失敗";
    console.error("人工餘額調整失敗", message);
    return failed(message, 409);
  }
}
