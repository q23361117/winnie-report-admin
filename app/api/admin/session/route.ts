
import { NextRequest, NextResponse } from "next/server";

import {
  ADMIN_COOKIE,
  createAdminSession,
} from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ========================================
// 驗證請求是否來自本站
// ========================================

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");

  return origin === request.nextUrl.origin;
}

// ========================================
// 管理員登入：建立 Session
// ========================================

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "不允許跨網站登入請求。" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    if (
      !body ||
      typeof body.idToken !== "string" ||
      !body.idToken.trim()
    ) {
      return NextResponse.json(
        { error: "缺少登入驗證資訊。" },
        { status: 400 }
      );
    }

    const session = await createAdminSession(
      body.idToken
    );

    const response = NextResponse.json({
      success: true,
      message: "管理員登入成功。",
    });

    response.cookies.set(
      ADMIN_COOKIE,
      session,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      }
    );

    return response;
  } catch (error) {
    console.error(
      "管理員登入失敗：",
      error instanceof Error
        ? error.message
        : "未知錯誤"
    );

    return NextResponse.json(
      {
        success: false,
        error: "登入失敗，請確認管理員帳號與權限。",
      },
      { status: 401 }
    );
  }
}

// ========================================
// 管理員登出：清除 Session Cookie
// ========================================

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "不允許跨網站登出請求。" },
      { status: 403 }
    );
  }

  const response = NextResponse.json({
    success: true,
    message: "管理員已登出。",
  });

  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
