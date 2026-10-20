import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getAdminSession } from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}
async function authorize() {
  return Boolean(await getAdminSession());
}
function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function millis(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value &&
    typeof value.toMillis === "function" ? value.toMillis() : undefined;
}
const pendingCollection = adminDb.collection("pendingLineUsers");
const customerCollection = adminDb.collection("postpaidCustomers");
const indexCollection = adminDb.collection("postpaidLineBindings");

// 分頁讀取：每次最多 50 筆。只在管理員主動開啟／翻頁／重新整理時讀取。
export async function GET(request: NextRequest) {
  if (!(await authorize())) return fail("管理員登入已失效", 401);
  try {
    const cursor = request.nextUrl.searchParams.get("cursor");
    if (cursor && (cursor.includes("/") || cursor.length > 200)) return fail("分頁游標錯誤", 400);
    let query = pendingCollection.orderBy(FieldPath.documentId()).limit(51);
    if (cursor) query = query.startAfter(cursor);
    const [pending, customers] = await Promise.all([query.get(), customerCollection.get()]);
    const page = pending.docs.slice(0, 50);
    return NextResponse.json({
      success: true,
      users: page.map(d => {
        const v = d.data();
        return {
          id: d.id, lineUserId: text(v.lineUserId), displayName: text(v.displayName),
          pictureUrl: text(v.pictureUrl), statusMessage: text(v.statusMessage),
          lastMessage: text(v.lastMessage), eventType: text(v.eventType),
          bindingStatus: text(v.bindingStatus) || "pending",
          boundCustomerId: text(v.boundCustomerId),
          boundCustomerCode: text(v.boundCustomerCode),
          boundCustomerName: text(v.boundCustomerName),
          isFriend: v.isFriend !== false, lastSeenAt: millis(v.lastSeenAt),
        };
      }),
      customers: customers.docs.map(d => {
        const v = d.data();
        return { id: d.id, customerCode: text(v.customerCode), name: text(v.name),
          phone: text(v.phone), lineUserId: text(v.lineUserId), status: text(v.status) || "active" };
      }),
      nextCursor: pending.docs.length > 50 ? page[page.length - 1].id : null,
      hasMore: pending.docs.length > 50,
    });
  } catch (error) {
    console.error("LINE 名單讀取失敗", error);
    return fail("讀取失敗，請查看 Firestore 配額與伺服器紀錄", 503);
  }
}

// 僅修改 LINE 對應欄位，不修改 balance、openingBalance、集點或交易紀錄。
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("跨網站請求被拒絕", 403);
  if (!(await authorize())) return fail("管理員登入已失效", 401);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("無效的 JSON", 400); }
  const action = text(body.action);
  const pendingId = text(body.pendingId);
  const customerId = text(body.customerId);
  if (!["bind", "unbind"].includes(action) || !pendingId || pendingId.includes("/")) return fail("操作參數錯誤", 400);
  if (action === "bind" && (!customerId || customerId.includes("/"))) return fail("請選擇客戶", 400);

  try {
    const pendingRef = pendingCollection.doc(pendingId);
    // 先做舊資料唯一性檢查，交易內則使用唯一索引避免新請求並行衝突。
    const pendingBefore = await pendingRef.get();
    if (!pendingBefore.exists) return fail("待綁定 LINE 不存在", 404);
    const lineUid = text(pendingBefore.get("lineUserId"));
    if (!lineUid) return fail("LINE UID 不存在", 400);
    const indexId = createHash("sha256").update(lineUid).digest("hex");
    const indexRef = indexCollection.doc(indexId);

    if (action === "bind") {
      const alreadyUsed = await customerCollection.where("lineUserId", "==", lineUid).limit(2).get();
      if (alreadyUsed.docs.some(d => d.id !== customerId)) {
        return fail("此 LINE 已綁定其他客戶，請先解除舊綁定", 409);
      }
    }

    await adminDb.runTransaction(async tx => {
      const pending = await tx.get(pendingRef);
      if (!pending.exists) throw new Error("LINE 使用者資料已不存在");
      if (text(pending.get("lineUserId")) !== lineUid) throw new Error("LINE UID 已變更，請重新整理");
      const boundCustomerId = text(pending.get("boundCustomerId"));
      const targetId = action === "bind" ? customerId : boundCustomerId;
      if (!targetId) throw new Error("這筆 LINE 尚未綁定");
      const customerRef = customerCollection.doc(targetId);
      const [customer, index] = await Promise.all([tx.get(customerRef), tx.get(indexRef)]);
      if (!customer.exists) throw new Error("後結客戶不存在");
      const existingUid = text(customer.get("lineUserId"));
      if (action === "bind") {
        if (boundCustomerId && boundCustomerId !== targetId) throw new Error("這筆 LINE 已綁定其他客戶");
        if (existingUid && existingUid !== lineUid) throw new Error("客戶已綁定其他 LINE，請先解除");
        if (index.exists && text(index.get("customerId")) !== targetId) throw new Error("LINE UID 已由其他客戶使用");
        tx.set(indexRef, { lineUserId: lineUid, customerId: targetId, updatedAt: FieldValue.serverTimestamp() });
        tx.update(customerRef, {
          lineUserId: lineUid, lineDisplayName: text(pending.get("displayName")),
          linePictureUrl: text(pending.get("pictureUrl")),
          lineBoundAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(pendingRef, {
          bindingStatus: "bound", boundCustomerId: targetId,
          boundCustomerCode: text(customer.get("customerCode")),
          boundCustomerName: text(customer.get("name")),
          boundAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        if (existingUid && existingUid !== lineUid) throw new Error("客戶已改綁其他 LINE，請重新整理");
        if (index.exists && text(index.get("customerId")) !== targetId) throw new Error("LINE 索引已指向其他客戶");
        if (index.exists) tx.delete(indexRef);
        if (existingUid === lineUid) tx.update(customerRef, {
          lineUserId: "", lineDisplayName: "", linePictureUrl: "",
          lineBoundAt: null, updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(pendingRef, {
          bindingStatus: "pending", boundCustomerId: "", boundCustomerCode: "",
          boundCustomerName: "", boundAt: null, updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return NextResponse.json({ success: true, action });
  } catch (error) {
    console.error("LINE 綁定失敗", error);
    const message = error instanceof Error ? error.message : "操作失敗";
    if (/quota|RESOURCE_EXHAUSTED|resource-exhausted/i.test(message)) return fail("Firestore 免費讀取額度已用完，請稍後重試", 429);
    if (/不存在|已綁|已變更|已改綁|已指向|尚未綁定/.test(message)) return fail(message, 409);
    return fail("伺服器操作失敗，請查看紀錄", 500);
  }
}
