
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import "@/lib/firebase";

export default function AdminLoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");

    const auth = getAuth();

    try {
      await setPersistence(
        auth,
        inMemoryPersistence
      );

      const credential =
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      const idToken =
        await credential.user.getIdToken();

      const response = await fetch(
        "/api/admin/session",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            idToken,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "管理員登入失敗。"
        );
      }

      // 後續使用伺服器 Session Cookie
      await signOut(auth);

      router.replace("/postpaid");
      router.refresh();
    } catch (loginError) {
      await signOut(auth).catch(() => {});

      console.error(
        "管理員登入失敗：",
        loginError
      );

      setError(
        loginError instanceof Error
          ? loginError.message
          : "管理員登入失敗。"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-5 py-10">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-3xl bg-white p-8 shadow-lg ring-1 ring-slate-200"
      >
        <div className="mb-8 text-center">
          <div className="text-5xl">🚕</div>

          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            維尼車隊
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            後結帳務管理員登入
          </p>
        </div>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">
            管理員 Email
          </span>

          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="請輸入管理員 Email"
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none focus:border-blue-500"
          />
        </label>

        <label className="mt-5 block">
          <span className="text-sm font-bold text-slate-700">
            管理員密碼
          </span>

          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="請輸入管理員密碼"
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none focus:border-blue-500"
          />
        </label>

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-7 w-full rounded-xl bg-blue-600 py-3 font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {loading
            ? "登入驗證中..."
            : "管理員登入"}
        </button>

        <p className="mt-5 text-center text-xs text-slate-400">
          🔒 僅限維尼車隊授權管理員使用
        </p>
      </form>
    </main>
  );
}
