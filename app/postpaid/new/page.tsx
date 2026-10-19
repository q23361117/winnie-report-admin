
"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function normalizeCustomerCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export default function NewPostpaidCustomerPage() {
  const router = useRouter();

  const [customerCode, setCustomerCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [lineUserId, setLineUserId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    const normalizedCode = normalizeCustomerCode(customerCode);
    const balance = Number(openingBalance);

    if (!normalizedCode) {
      setError("請輸入客戶代號。");
      return;
    }

    if (!name.trim()) {
      setError("請輸入客戶姓名。");
      return;
    }

    if (
      !openingBalance.trim() ||
      !Number.isSafeInteger(balance)
    ) {
      setError("初始餘額必須是有效的整數。");
      return;
    }

    setSaving(true);
    setError("");

    try {
      // 使用管理員 Session Cookie
      // 不再透過 Firebase auth.currentUser 驗證
      const response = await fetch(
        "/api/postpaid/customers",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({
            customerCode: normalizedCode,
            name: name.trim(),
            phone: phone.trim(),
            openingBalance: balance,
            lineUserId: lineUserId.trim(),
            note: note.trim(),
          }),
        }
      );

      const result = await response.json();

      if (response.status === 401) {
        router.push("/admin-login");

        throw new Error(
          "管理員登入已失效，請重新登入。"
        );
      }

      if (!response.ok) {
        throw new Error(
          result.error || "新增後結客戶失敗。"
        );
      }

      if (!result.customerId) {
        throw new Error(
          "建立結果缺少客戶編號，請先檢查客戶名單。"
        );
      }

      // 新增成功後跳轉至客戶帳務
      router.push(`/postpaid/${result.customerId}`);
      router.refresh();
    } catch (submitError) {
      console.error(
        "新增後結客戶失敗：",
        submitError
      );

      setError(
        submitError instanceof Error
          ? submitError.message
          : "新增後結客戶失敗。"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-600">
              後結帳務系統
            </p>

            <h1 className="mt-1 text-3xl font-bold">
              新增後結客戶
            </h1>
          </div>

          <Link
            href="/postpaid"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600"
          >
            返回名單
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70 md:p-8"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-bold">
                客戶代號 *
              </span>

              <input
                required
                value={customerCode}
                onChange={(event) =>
                  setCustomerCode(event.target.value)
                }
                placeholder="例如：0059/左"
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              />

              <span className="mt-2 block text-xs text-slate-400">
                必須與 Google 報表的客戶代號完全一致。
              </span>
            </label>

            <label className="block">
              <span className="text-sm font-bold">
                客戶姓名 *
              </span>

              <input
                required
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                placeholder="輸入客戶姓名"
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold">
                手機號碼
              </span>

              <input
                type="tel"
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value)
                }
                placeholder="例如：0988330647"
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold">
                初始餘額
              </span>

              <input
                type="number"
                step="1"
                required
                value={openingBalance}
                onChange={(event) =>
                  setOpeningBalance(event.target.value)
                }
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              />

              <span className="mt-2 block text-xs text-slate-400">
                欠款請輸入負數，例如欠 527 元填 -527。
              </span>
            </label>

            <label className="block md:col-span-2">
              <span className="text-sm font-bold">
                LINE User ID
              </span>

              <input
                value={lineUserId}
                onChange={(event) =>
                  setLineUserId(event.target.value)
                }
                placeholder="可先留空，日後再綁定"
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="text-sm font-bold">
                備註
              </span>

              <textarea
                value={note}
                onChange={(event) =>
                  setNote(event.target.value)
                }
                rows={4}
                placeholder="可記錄帳務方式、聯絡時間或其他資訊"
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <div className="mt-7 flex justify-end gap-3">
            <Link
              href="/postpaid"
              className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600"
            >
              取消
            </Link>

            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving
                ? "建立中..."
                : "建立後結客戶"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
