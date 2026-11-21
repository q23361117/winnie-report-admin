import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminSession } from "@/lib/admin-session";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return failure("禁止跨站請求", 403);
  }
  const admin = await getAdminSession();
  if (!admin) return failure("請重新登入管理員", 401);
  if (process.env.WINNIE_CREDIT_ADJUST_ENABLED !== "true") {
    return failure("乘車金管理員寫入權限尚未啟用", 423);
  }
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure("資料格式不正確", 400);
    const data = body as Record<string, unknown>;
    const code = String(data.memberCode ?? "").trim().toUpperCase();
    const mode = data.mode;
    const amount = data.amount;
    const expectedBalance = data.expectedBalance;
    const reason = String(data.reason ?? "").trim();
    const operationId = String(data.operationId ?? "").trim();
    if (!/^V\d{2,10}$/.test(code)) return failure("會員代號不正確", 400);
    if (mode !== "add" && mode !== "use") return failure("操作類型不正確", 400);
    if (!Number.isSafeInteger(amount) || Number(amount) < 1 || Number(amount) > 100000) return failure("調整金額不正確", 400);
    if (!Number.isSafeInteger(expectedBalance) || Number(expectedBalance) < 0) return failure("目前餘額不正確", 400);
    if (reason.length < 12 || reason.length > 500) return failure("請填寫至少12字的核對依據", 400);
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) return failure("操作編號不正確", 400);
    if (data.confirmation !== `確認${mode === "add" ? "增加" : "使用"}${code}`) return failure("確認文字不正確", 400);
    const memberRef = adminDb.collection("members").doc(code);
    const recordRef = adminDb.collection("rideCreditTransactions").doc(`admin_credit_${operationId}`);
    const result = await adminDb.runTransaction(async (tx) => {
      const [memberDoc, recordDoc] = await Promise.all([tx.get(memberRef), tx.get(recordRef)]);
      if (recordDoc.exists) {
        const old = recordDoc.data() || {};
        if (old.memberCode !== code || old.adjustMode !== mode || old.adjustAmount !== amount || old.operationId !== operationId) {
          throw new Error("同一操作編號已被使用，拒絕重複操作");
        }
        return { repeated: true, before: old.balanceBefore, after: old.balanceAfter };
      }
      if (!memberDoc.exists) throw new Error("找不到會員主檔");
      const member = memberDoc.data() || {};
      if (String(member.memberCode ?? code).trim().toUpperCase() !== code) throw new Error("會員編號不一致");
      if (String(member.status ?? "active") !== "active") throw new Error("會員未啟用");
      if (member.needsManualReview === true || Number(member.pendingCreditRecovery ?? 0) !== 0) throw new Error("會員有待人工審核或回收金額，禁止調整");
      const current = Number(member.rideCredit);
      if (!Number.isSafeInteger(current) || current < 0) throw new Error("會員乘車金資料異常");
      if (current !== expectedBalance) throw new Error(`餘額已變動，目前 $${current}，請重新整理後核對`);
      if (mode === "use" && current < Number(amount)) throw new Error("可用乘車金不足");
      const signed = mode === "use" ? -Number(amount) : Number(amount);
      const after = current + signed;
      const now = FieldValue.serverTimestamp();
      tx.update(memberRef, { rideCredit: after, updatedAt: now });
      tx.create(recordRef, {
        transactionId: recordRef.id, operationId, memberCode: code,
        memberName: String(member.name ?? ""), amount: signed,
        adjustAmount: amount, adjustMode: mode, type: mode === "add" ? "manual_add" : "use",
        status: "active", reason, source: "admin_dashboard",
        balanceBefore: current, balanceAfter: after,
        actorUid: admin.uid, createdAt: now,
      });
      return { repeated: false, before: current, after };
    });
    return NextResponse.json({ success: true, ...result, lineSent: false, postpaidModified: false });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "乘車金調整失敗", 409);
  }
}
