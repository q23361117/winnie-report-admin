
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ========================================
// 維尼車隊｜管理員登出按鈕
// ========================================

export default function LogoutButton() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    if (loading) return;

    setLoading(true);

    try {
      const response = await fetch(
        "/api/admin/session",
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );

      if (!response.ok) {
        throw new Error("登出失敗，請稍後再試。");
      }

      router.replace("/admin-login");
      router.refresh();
    } catch (error) {
      console.error("管理員登出失敗：", error);

      alert(
        error instanceof Error
          ? error.message
          : "登出失敗。"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? "登出中..." : "🚪 登出"}
    </button>
  );
}
