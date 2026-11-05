import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getAdminSession } from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pendingCollection = adminDb.collection("pendingLineUsers");
const customerCollection = adminDb.collection("postpaidCustomers");
const indexCollection = adminDb.collection("postpaidLineBindings");
const PAGE_SIZE = 20;
const INDEX_BATCH_SIZE = 10;

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}
async function authorize() {
  return Boolean(await getAdminSession());
}
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function normalize(value: unknown) { return text(value).normalize("NFKC").trim().toLowerCase(); }
function millis(value: unknown): number | undefined {
  return value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function"
    ? value.toMillis() : undefined;
}
function tokenize(values: unknown[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const s = normalize(value).slice(0, 36);
    for (let i = 0; i < s.length && set.size < 240; i++) {
      for (let j = i + 1; j <= Math.min(s.length, i + 24) && set.size < 240; j++) set.add(s.slice(i, j));
    }
  }
  return [...set];
}
function serializeUser(d: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const v = d.data() || {};
  return {
    id: d.id,
    lineUserId: text(v.lineUserId),
    displayName: text(v.displayName),
    pictureUrl: text(v.pictureUrl),
    statusMessage: text(v.statusMessage),
    adminAlias: text(v.adminAlias),
    lastMessage: text(v.lastMessage),
    eventType: text(v.eventType),
    bindingStatus: text(v.bindingStatus) || "pending",
    boundCustomerId: text(v.boundCustomerId),
    boundCustomerCode: text(v.boundCustomerCode),
    boundCustomerName: text(v.boundCustomerName),
    isFriend: v.isFriend !== false,
    lastSeenAt: millis(v.lastSeenAt),
  };
}
function serializeCustomer(d: FirebaseFirestore.QueryDocumentSnapshot) {
  const v = d.data();
  return {
    id: d.id, customerCode: text(v.customerCode), name: text(v.name),
    phone: text(v.phone), lineUserId: text(v.lineUserId), status: text(v.status) || "active",
  };
}
function hashId(uid: string) {
  return createHash("sha256").update(uid).digest("hex").slice(0, 40);
}
function indexId(uid: string) {
  return createHash("sha256").update(uid).digest("hex");
}
function errorMessage(error: unknown) {
  const s = error instanceof Error ? error.message : String(error);
  if (/RESOURCE_EXHAUSTED|quota|resource-exhausted/i.test(s)) return { message: "Firestore 配額已達上限，請稍後重試", status: 429 };
  if (/FAILED_PRECONDITION|requires an index|index is required/i.test(s)) return { message: "Firestore 缺少查詢索引，請查看 Vercel Logs 中的索引建立連結", status: 503 };
  if (/PERMISSION_DENIED|permission-denied/i.test(s)) return { message: "Firestore 權限不足", status: 403 };
  return { message: "Firestore 查詢失敗，請查看 Vercel Logs", status: 503 };
}

export async function GET(request: NextRequest) {
  if (!(await authorize())) return fail("管理員登入已失效", 401);
  try {
    const mode = request.nextUrl.searchParams.get("mode") || "recent";
    const keyword = normalize(request.nextUrl.searchParams.get("search") || "");
    const cursor = request.nextUrl.searchParams.get("cursor") || "";
    let users: ReturnType<typeof serializeUser>[] = [];
    let hasMore = false;
    let nextCursor: string | null = null;

    if (mode === "search") {
      if (!keyword || keyword.length > 24) return fail("搜尋文字請輸入 1 至 24 個字", 400);
      if (/^U[0-9a-f]{32}$/i.test(keyword)) {
        const exact = await pendingCollection.doc(hashId(keyword.charAt(0).toUpperCase() + keyword.slice(1))).get();
        users = exact.exists ? [serializeUser(exact)] : [];
      } else {
        // 精準使用 array-contains 索引，不掃描 513 / 1000 筆原始文件。
        const snap = await pendingCollection.where("searchTokens", "array-contains", keyword).limit(30).get();
        users = snap.docs.map(serializeUser);
      }
    } else if (mode === "recent") {
      let query = pendingCollection
        .orderBy("lastSeenAt", "desc")
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE + 1);
      if (cursor) {
        let obj: { ms?: number; id?: string };
        try { obj = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
        catch { return fail("分頁游標無效", 400); }
        if (!Number.isSafeInteger(obj.ms) || !obj.id || obj.id.includes("/") || obj.id.length > 100) {
          return fail("分頁游標錯誤", 400);
        }
        query = query.startAfter(Timestamp.fromMillis(obj.ms!), obj.id);
      }
      const snap = await query.get();
      hasMore = snap.docs.length > PAGE_SIZE;
      const page = snap.docs.slice(0, PAGE_SIZE);
      users = page.map(serializeUser);
      if (hasMore && page.length) {
        const last = page[page.length - 1];
        const ms = millis(last.get("lastSeenAt"));
        if (ms !== undefined) nextCursor = Buffer.from(JSON.stringify({ ms, id: last.id })).toString("base64url");
      }
    } else {
      return fail("不支援的查詢模式", 400);
    }

    const customers = await customerCollection.limit(100).get();
    return NextResponse.json({
      success: true, users,
      customers: customers.docs.map(serializeCustomer),
      mode, hasMore, nextCursor,
      note: mode === "search" ? "搜尋已建立索引的暱稱、別名與客戶資料；舊資料須先分批補建索引" : "顯示最近互動的 LINE 使用者",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("LINE_BINDINGS_GET_ERROR", error);
    const e = errorMessage(error);
    return fail(e.message, e.status);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("跨網站請求被拒絕", 403);
  if (!(await authorize())) return fail("管理員登入已失效", 401);
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return fail("JSON 格式錯誤", 400); }
  const action = text(body.action);

  // 僅在管理員點擊後執行。分批讀取，每份文件獨立更新，便於定位錯誤。
  // 不修改 LINE 綁定、會員餘額或集點。
  if (action === "indexBatch") {
    const cursor = text(body.cursor);
    if (cursor.length > 100 || cursor.includes("/")) return fail("索引游標錯誤", 400);

    let stage = "query";
    let processed = 0;
    let updated = 0;
    let lastProcessedCursor: string | null = null;
    try {
      let query = pendingCollection.orderBy(FieldPath.documentId()).limit(INDEX_BATCH_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();

      // 改為逐筆更新。若有某一筆資料不合法，不會讓整批的所有更新失敗。
      // 遇到錯誤即停止，重試時會從上一筆成功處理的文件繼續。
      for (const doc of snap.docs) {
        stage = "tokenize";
        const data = doc.data();
        const tokens = tokenize([
          data.displayName, data.adminAlias, data.boundCustomerCode, data.boundCustomerName,
        ]);
        if (JSON.stringify(data.searchTokens || []) !== JSON.stringify(tokens)) {
          stage = "write";
          try {
            await doc.ref.update({ searchTokens: tokens });
          } catch (writeError) {
            console.error("LINE_INDEX_BATCH_DOCUMENT_ERROR", {
              stage,
              // Firestore 文件 ID 不輸出到客戶端，避免洩漏個人識別資訊。
              code: typeof writeError === "object" && writeError !== null && "code" in writeError
                ? String(writeError.code) : "unknown",
              message: writeError instanceof Error ? writeError.message : String(writeError),
              tokenCount: tokens.length,
            });
            throw writeError;
          }
          updated++;
        }
        processed++;
        lastProcessedCursor = doc.id;
      }

      return NextResponse.json({
        success: true,
        processed,
        updated,
        nextCursor: lastProcessedCursor,
        hasMore: snap.size === INDEX_BATCH_SIZE,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("LINE_INDEX_BATCH_ERROR", {
        stage,
        processed,
        updated,
        code: typeof error === "object" && error !== null && "code" in error
          ? String(error.code) : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      const e = errorMessage(error);
      return NextResponse.json({
        success: false,
        error: `${e.message}（階段：${stage}；已處理 ${processed} 筆）`,
      }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    }
  }

  // 管理員可新增搜尋別名；不會改動 LINE 官方後台的自訂暱稱。
  if (action === "setAlias") {
    const pendingId = text(body.pendingId);
    const alias = text(body.alias).trim().slice(0, 36);
    if (!pendingId || pendingId.includes("/")) return fail("無效的 LINE 文件", 400);
    try {
      const ref = pendingCollection.doc(pendingId);
      const doc = await ref.get();
      if (!doc.exists) return fail("LINE 使用者不存在", 404);
      const v = doc.data() || {};
      await ref.update({ adminAlias: alias, searchTokens: tokenize([v.displayName, alias, v.boundCustomerCode, v.boundCustomerName]), updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ success: true });
    } catch (error) { console.error("LINE_ALIAS_ERROR", error); const e = errorMessage(error); return fail(e.message, e.status); }
  }

  if (action !== "bind" && action !== "unbind") return fail("不支援的操作", 400);
  const pendingId = text(body.pendingId);
  const customerId = text(body.customerId);
  if (!pendingId || pendingId.includes("/")) return fail("LINE 文件 ID 錯誤", 400);
  if (action === "bind" && (!customerId || customerId.includes("/"))) return fail("請先選擇後結客戶", 400);
  try {
    const pendingRef = pendingCollection.doc(pendingId);
    const before = await pendingRef.get();
    if (!before.exists) return fail("LINE 使用者不存在", 404);
    const uid = text(before.get("lineUserId"));
    if (!uid) return fail("找不到 LINE User ID", 400);
    const bindingRef = indexCollection.doc(indexId(uid));
    if (action === "bind") {
      const used = await customerCollection.where("lineUserId", "==", uid).limit(2).get();
      if (used.docs.some(d => d.id !== customerId)) return fail("LINE 已綁定其他客戶，請先解除", 409);
    }
    await adminDb.runTransaction(async tx => {
      const pending = await tx.get(pendingRef);
      if (!pending.exists || text(pending.get("lineUserId")) !== uid) throw new Error("LINE UID 不存在或已改變");
      const boundId = text(pending.get("boundCustomerId"));
      const targetId = action === "bind" ? customerId : boundId;
      if (!targetId) throw new Error("目前沒有綁定客戶");
      const customerRef = customerCollection.doc(targetId);
      const [customer, index] = await Promise.all([tx.get(customerRef), tx.get(bindingRef)]);
      if (!customer.exists) throw new Error("後結客戶不存在");
      const existingUid = text(customer.get("lineUserId"));
      if (action === "bind") {
        if (boundId && boundId !== targetId) throw new Error("這個 LINE 已綁其他客戶");
        if (existingUid && existingUid !== uid) throw new Error("客戶已綁其他 LINE，請先解除");
        if (index.exists && text(index.get("customerId")) !== targetId) throw new Error("LINE UID 已被其他客戶使用");
        tx.set(bindingRef, { lineUserId: uid, customerId: targetId, updatedAt: FieldValue.serverTimestamp() });
        tx.update(customerRef, { lineUserId: uid, lineDisplayName: text(pending.get("displayName")),
          linePictureUrl: text(pending.get("pictureUrl")), lineBoundAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp() });
        const code = text(customer.get("customerCode"));
        const name = text(customer.get("name"));
        tx.update(pendingRef, { bindingStatus: "bound", boundCustomerId: targetId,
          boundCustomerCode: code, boundCustomerName: name, boundAt: FieldValue.serverTimestamp(),
          searchTokens: tokenize([pending.get("displayName"), pending.get("adminAlias"), code, name]),
          updatedAt: FieldValue.serverTimestamp() });
      } else {
        if (existingUid && existingUid !== uid) throw new Error("客戶已改綁其他 LINE");
        if (index.exists && text(index.get("customerId")) !== targetId) throw new Error("LINE 索引不一致");
        if (index.exists) tx.delete(bindingRef);
        if (existingUid === uid) tx.update(customerRef, { lineUserId: "", lineDisplayName: "", linePictureUrl: "",
          lineBoundAt: null, updatedAt: FieldValue.serverTimestamp() });
        tx.update(pendingRef, { bindingStatus: "pending", boundCustomerId: "", boundCustomerCode: "",
          boundCustomerName: "", boundAt: null,
          searchTokens: tokenize([pending.get("displayName"), pending.get("adminAlias")]),
          updatedAt: FieldValue.serverTimestamp() });
      }
    });
    return NextResponse.json({ success: true, action });
  } catch (error) {
    console.error("LINE_BINDINGS_WRITE_ERROR", error);
    const s = error instanceof Error ? error.message : "綁定失敗";
    const e = errorMessage(error);
    if (e.status !== 503) return fail(e.message, e.status);
    if (/不存在|已綁|已改|不一致|沒有綁定|被其他/.test(s)) return fail(s, 409);
    return fail("後結綁定失敗，請查看 Vercel Logs", 500);
  }
}
