
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import {
  FieldValue,
} from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase-admin";
import { getAdminSession } from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ========================================
// 維尼車隊｜新增後結客戶 API
// 使用管理員 Session Cookie 驗證
// ========================================

function normalizeCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function getCustomerId(code: string) {
  return createHash("sha256")
    .update(code, "utf8")
    .digest("hex")
    .slice(0, 40);
}

function jsonError(
  message: string,
  status: number
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

// ========================================
// 新增後結客戶
// ========================================

export async function POST(request: NextRequest) {
  // 只接受本站送出的寫入請求
  const origin = request.headers.get("origin");

  if (origin !== request.nextUrl.origin) {
    return jsonError(
      "不允許跨網站新增客戶。",
      403
    );
  }

  // ======================================
  // 管理員 Session 驗證
  // ======================================

  const admin = await getAdminSession();

  if (!admin) {
    return jsonError(
      "管理員登入已失效，請重新登入。",
      401
    );
  }

  try {
    // ====================================
    // 解析新增客戶資料
    // ====================================

    let body: Record<string, unknown>;

    try {
      const input: unknown = await request.json();

      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      ) {
        return jsonError(
          "新增客戶資料格式不正確。",
          400
        );
      }

      body = input as Record<string, unknown>;
    } catch {
      return jsonError(
        "無法解析新增客戶資料。",
        400
      );
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

    // ====================================
    // 檢查必填資料
    // ====================================

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

    // ====================================
    // 產生固定客戶 ID
    // ====================================

    const customerId =
      getCustomerId(customerCode);

    const customerRef = adminDb
      .collection("postpaidCustomers")
      .doc(customerId);

    // ====================================
    // 建立客戶
    // create() 不會覆蓋已存在的客戶
    // ====================================

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
    } catch (writeError: unknown) {
      const code =
        typeof writeError === "object" &&
        writeError !== null &&
        "code" in writeError
          ? String(writeError.code)
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

      throw writeError;
    }

    // ====================================
    // 新增成功
    // ====================================

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
      "伺服器新增客戶失敗，請檢查部署紀錄。",
      500
    );
  }
}
