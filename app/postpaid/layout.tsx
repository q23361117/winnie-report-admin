
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-session";

import LogoutButton from "./logout-button";

// ========================================
// 維尼車隊｜後結帳務登入保護
// ========================================

export const dynamic = "force-dynamic";

export default async function PostpaidLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 檢查管理員 Session
  const admin = await getAdminSession();

  // 沒有登入就導向管理員登入頁
  if (!admin) {
    redirect("/admin-login");
  }

  return (
    <>
      {/* 管理員登入狀態 */}
      <div className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-5 py-3">

        <span className="text-xs font-medium text-slate-500">
          🔒 維尼車隊管理員已登入
        </span>

        <LogoutButton />

      </div>

      {/* 原本後結帳務系統 */}
      {children}
    </>
  );
}
