
import "server-only";

import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { cookies } from "next/headers";

import "@/lib/firebase-admin";

// ========================================
// 維尼車隊｜管理員 Session 設定
// ========================================

// 管理員登入 Cookie 名稱
export const ADMIN_COOKIE = "winnie_admin_session";

// Session 有效期限：7 天
export const SESSION_DURATION =
  7 * 24 * 60 * 60 * 1000;

// ========================================
// 取得 Firebase Admin Auth
// 沿用原本 firebase-admin.ts 的初始化
// ========================================

function getAdminAuth() {
  const app = getApps()[0];

  if (!app) {
    throw new Error(
      "Firebase Admin 尚未初始化，請檢查 firebase-admin.ts"
    );
  }

  return getAuth(app);
}

// ========================================
// 取得授權管理員 UID
// ========================================

function getAdminUid(): string {
  const uid =
    process.env.WINNIE_ADMIN_UID?.trim();

  if (!uid) {
    throw new Error(
      "缺少 WINNIE_ADMIN_UID，請檢查 Vercel 環境變數。"
    );
  }

  return uid;
}

// ========================================
// 驗證管理員 Firebase ID Token
// ========================================

export async function verifyAdminIdToken(
  idToken: string
) {
  if (!idToken?.trim()) {
    throw new Error("缺少登入驗證 Token。");
  }

  const decoded = await getAdminAuth()
    .verifyIdToken(idToken, true);

  if (decoded.uid !== getAdminUid()) {
    throw new Error(
      "此帳號沒有維尼車隊管理員權限。"
    );
  }

  return decoded;
}

// ========================================
// 建立管理員 Session
// ========================================

export async function createAdminSession(
  idToken: string
): Promise<string> {
  const decoded =
    await verifyAdminIdToken(idToken);

  // 必須是最近 5 分鐘內完成的登入
  const nowSeconds = Math.floor(
    Date.now() / 1000
  );

  if (
    typeof decoded.auth_time !== "number" ||
    nowSeconds - decoded.auth_time > 300
  ) {
    throw new Error(
      "登入驗證已逾時，請重新輸入管理員帳號密碼。"
    );
  }

  return getAdminAuth().createSessionCookie(
    idToken,
    {
      expiresIn: SESSION_DURATION,
    }
  );
}

// ========================================
// 取得並驗證管理員 Session
// ========================================

export async function getAdminSession() {
  const cookieStore = await cookies();

  const sessionCookie =
    cookieStore.get(ADMIN_COOKIE)?.value;

  if (!sessionCookie) {
    return null;
  }

  try {
    const decoded =
      await getAdminAuth().verifySessionCookie(
        sessionCookie,
        true
      );

    if (decoded.uid !== getAdminUid()) {
      return null;
    }

    return decoded;
  } catch (error) {
    console.error(
      "管理員 Session 驗證失敗：",
      error instanceof Error
        ? error.message
        : "未知錯誤"
    );

    return null;
  }
}

// ========================================
// 要求管理員登入
// 未授權時拋出錯誤
// ========================================

export async function requireAdminSession() {
  const admin = await getAdminSession();

  if (!admin) {
    throw new Error(
      "管理員尚未登入或登入已失效。"
    );
  }

  return admin;
}
