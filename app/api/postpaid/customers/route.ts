
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";

import { getAuth } from "firebase-admin/auth";

import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const encoded =
    process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64;

  if (encoded) {
    const json = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8")
    );

    return initializeApp({
      credential: cert(json),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
  });
}

function normalizeCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function getCustomerId(code: string) {
  return createHash("sha256")
    .update(code, "utf8")
    .digest("hex")
    .slice(0, 40);
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

export async function POST(request: NextRequest) {
  try {
    const authHeader =
      request.headers.get("authorization") || "";

    if (!authHeader.startsWith("Bearer ")) {
      return jsonError("缺少登入驗證資訊。", 401);
    }

    const idToken = authHeader.slice(7).trim();

    if (!idToken) {
      return jsonError("登入驗證資訊無效。", 401);
    }

    const adminApp = getAdminApp();

    let decoded;

    try {
      decoded = await getAuth(adminApp)
        .verifyIdToken(idToken, true);
    } catch {
      return jsonError(
        "登入已失效，請重新登入。",
        401
      );
    }

    // 只有具備 Firebase admin Custom Claim
    // 的管理員才能建立後結客戶。
    if (decoded.admin !== true) {
      return jsonError(
        "目前帳號沒有新增後結客戶的管理員權限。",
        403
      );
    }

    let body: Record<string, unknown>;

    try {
      const input = await request.json();

      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      ) {
        return jsonError("資料格式不正確。", 400);
      }

      body = input as Record<string, unknown>;
    } catch {
      return jsonError("無法解析新增資料。", 400);
    }

    const customerCode =
      typeof body.customerCode === "string"
        ? normalizeCode(body.customerCode)
        : "";

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const phone =
      typeof body.phone === "string"
        ? body.phone.trim()
        : "";

    const lineUserId =
      typeof body.lineUserId === "string"
        ? body.lineUserId.trim()
        : "";

    const note =
      typeof body.note === "string"
        ? body.note.trim()
        : "";

    const balance = body.openingBalance;

    if (
      !customerCode ||
      customerCode.length > 80
    ) {
      return jsonError(
        "請輸入有效的客戶代號。",
        400
      );
    }

    if (!name || name.length > 100) {
      return jsonError(
        "請輸入有效的客戶姓名。",
        400
      );
    }

    if (
      phone.length > 30 ||
      lineUserId.length > 200 ||
      note.length > 2000
    ) {
      return jsonError(
        "部分欄位超過允許長度。",
        400
      );
    }

    if (
      typeof balance !== "number" ||
      !Number.isSafeInteger(balance)
    ) {
      return jsonError(
        "初始餘額必須是有效的整數。",
        400
      );
    }

    const customerId = getCustomerId(customerCode);

    const db = getFirestore(adminApp);

    const customerRef = db
      .collection("postpaidCustomers")
      .doc(customerId);

    // 原子建立：同時避免多個請求重複建立。
    // 不覆蓋已有客戶及餘額。
    try {
      await customerRef.create({
        customerCode,
        name,
        phone,
        openingBalance: balance,
        balance,
        totalRides: 0,
        totalPostpaidAmount: 0,
        lineUserId,
        note,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error: unknown) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String(error.code)
          : "";

      if (
        code === "6" ||
        code === "already-exists"
      ) {
        return jsonError(
          "這個客戶代號已經建立過，請勿重複新增。",
          409
        );
      }

      throw error;
    }

    return NextResponse.json(
      {
        success: true,
        customerId,
        customerCode,
        message: "後結客戶建立成功。",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "新增後結客戶 API 失敗：",
      error
    );

    return jsonError(
      "伺服器新增失敗，請檢查後端設定與紀錄。",
      500
    );
  }
}
