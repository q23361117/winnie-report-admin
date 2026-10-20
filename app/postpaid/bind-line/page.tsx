"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PendingLineUser = {
  id: string;
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  statusMessage: string;
  lastMessage: string;
  eventType: string;
  bindingStatus: string;
  boundCustomerId: string;
  boundCustomerCode: string;
  boundCustomerName: string;
  isFriend: boolean;
  lastSeenAt?: number;
};

type PostpaidCustomer = {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  lineUserId: string;
  status: string;
};

function formatDate(value?: number) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function maskLineUserId(value: string) {
  if (!value) {
    return "—";
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 7)}••••••${value.slice(-5)}`;
}

export default function BindPostpaidLinePage() {
  const [lineUsers, setLineUsers] = useState<PendingLineUser[]>([]);
  const [customers, setCustomers] = useState<PostpaidCustomer[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<
    Record<string, string>
  >({});
  const [statusFilter, setStatusFilter] = useState("pending");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [fetchingMore, setFetchingMore] = useState(false);

  async function loadPage(nextCursor: string | null, replace = false) {
    if (!replace) setFetchingMore(true);
    setError("");
    try {
      const url = nextCursor
        ? `/api/postpaid/line-bindings?cursor=${encodeURIComponent(nextCursor)}`
        : "/api/postpaid/line-bindings";
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "讀取待綁定名單失敗");
      setLineUsers((previous) => replace
        ? result.users
        : [...previous, ...result.users.filter((u: PendingLineUser) =>
            !previous.some((p) => p.id === u.id))]);
      setCustomers(result.customers);
      setCursor(result.nextCursor ?? null);
      setHasMore(Boolean(result.hasMore));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "讀取失敗");
    } finally {
      setLoading(false);
      setFetchingMore(false);
    }
  }

  useEffect(() => {
    void loadPage(null, true);
    // 初次載入一次，不啟用全集合即時監聽。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitBinding(action: "bind" | "unbind", user: PendingLineUser, customerId?: string) {
    setWorkingId(user.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/postpaid/line-bindings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, pendingId: user.id, customerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失敗");
      setMessage(action === "bind" ? "LINE 綁定成功，未修改客戶餘額。" : "LINE 綁定已解除。");
      setSelectedCustomers((previous) => {
        const next = { ...previous };
        delete next[user.id];
        return next;
      });
      // 只重新讀取第一頁，不保留可能過期的資料。
      await loadPage(null, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失敗");
    } finally {
      setWorkingId("");
    }
  }

  const filteredUsers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return lineUsers.filter((user) => {
      if (
        statusFilter !== "all" &&
        user.bindingStatus !== statusFilter
      ) {
        return false;
      }

      if (!normalizedKeyword) {
        return true;
      }

      return [
        user.displayName,
        user.lastMessage,
        user.boundCustomerCode,
        user.boundCustomerName,
      ].some((value) =>
        value.toLowerCase().includes(normalizedKeyword)
      );
    });
  }, [keyword, lineUsers, statusFilter]);

  const activeCustomers = customers.filter(
    (customer) => customer.status === "active"
  );

  const pendingCount = lineUsers.filter(
    (user) => user.bindingStatus !== "bound"
  ).length;

  async function bindLineUser(user: PendingLineUser) {
    const customerId = selectedCustomers[user.id];
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return setError("請先選擇有效的後結客戶。");
    if (!user.lineUserId) return setError("缺少 LINE User ID。");
    if (customer.lineUserId && customer.lineUserId !== user.lineUserId) {
      return setError("該客戶已綁其他 LINE，請先解除原綁定。");
    }
    if (!window.confirm(`確定將「${user.displayName || "LINE 使用者"}」綁定至「${customer.customerCode}｜${customer.name}」嗎？`)) return;
    await submitBinding("bind", user, customerId);
  }

  async function unbindLineUser(user: PendingLineUser) {
    if (!window.confirm(`確定解除「${user.displayName || "LINE 使用者"}」的綁定嗎？`)) return;
    await submitBinding("unbind", user);
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold text-emerald-600">
              LINE 官方帳號綁定
            </p>
            <h1 className="mt-1 text-3xl font-bold">
              待綁定 LINE 使用者
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              客人傳訊息給官方帳號後，選擇對應的後結客戶完成綁定。
            </p>
          </div>

          <div className="flex gap-3">
            <Link
              href="/postpaid"
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600"
            >
              返回後結帳務
            </Link>

            <Link
              href="/postpaid/new"
              className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white"
            >
              新增後結客戶
            </Link>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-3">
          <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-sm text-slate-500">等待綁定</p>
            <p className="mt-4 text-3xl font-bold text-amber-600">
              {pendingCount} 位（已載入）
            </p>
          </article>

          <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-sm text-slate-500">已綁定</p>
            <p className="mt-4 text-3xl font-bold text-emerald-600">
              {
                lineUsers.filter(
                  (user) => user.bindingStatus === "bound"
                ).length
              }{" "}
              位
            </p>
          </article>

          <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-sm text-slate-500">可綁定後結客戶</p>
            <p className="mt-4 text-3xl font-bold text-blue-600">
              {activeCustomers.length} 位
            </p>
          </article>
        </section>

        {(message || error) && (
          <div
            className={`mt-5 rounded-xl px-4 py-3 text-sm ${
              error
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || message}
          </div>
        )}

        <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold">LINE 使用者名單</h2>
              <p className="mt-1 text-sm text-slate-500">
                每頁最多載入 50 筆；搜尋僅涵蓋已載入資料，可按下方「載入更多」。不再監聽完整集合。
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value)
                }
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500"
              >
                <option value="pending">等待綁定</option>
                <option value="bound">已綁定</option>
                <option value="all">全部</option>
              </select>

              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜尋名稱、訊息或客戶代號..."
                className="min-w-72 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {loading ? (
              <div className="py-12 text-center text-sm text-slate-500">
                讀取中...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center">
                <p className="font-bold text-slate-700">
                  目前沒有符合條件的 LINE 使用者
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  請先讓客人傳一則訊息給 LINE 官方帳號。
                </p>
              </div>
            ) : (
              filteredUsers.map((user) => (
                <article
                  key={user.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      {user.pictureUrl ? (
                        <img
                          src={user.pictureUrl}
                          alt={user.displayName || "LINE 使用者"}
                          className="h-16 w-16 shrink-0 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-2xl">
                          👤
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold">
                            {user.displayName || "未取得 LINE 名稱"}
                          </h3>

                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              user.bindingStatus === "bound"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {user.bindingStatus === "bound"
                              ? "已綁定"
                              : "等待綁定"}
                          </span>

                          {!user.isFriend && (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                              已封鎖／取消好友
                            </span>
                          )}
                        </div>

                        <p className="mt-2 text-sm text-slate-600">
                          最近訊息：
                          <span className="font-semibold">
                            {user.lastMessage || "—"}
                          </span>
                        </p>

                        <p className="mt-1 text-xs text-slate-400">
                          最後互動：{formatDate(user.lastSeenAt)}
                        </p>

                        <p className="mt-1 text-xs text-slate-400">
                          LINE User ID：{maskLineUserId(user.lineUserId)}
                        </p>

                        {user.bindingStatus === "bound" && (
                          <p className="mt-2 text-sm font-semibold text-emerald-700">
                            已綁定：
                            {user.boundCustomerCode || "—"}｜
                            {user.boundCustomerName || "未填姓名"}
                          </p>
                        )}
                      </div>
                    </div>

                    {user.bindingStatus === "bound" ? (
                      <button
                        type="button"
                        onClick={() => unbindLineUser(user)}
                        disabled={workingId === user.id}
                        className="rounded-xl bg-red-50 px-5 py-3 text-sm font-bold text-red-600 disabled:opacity-50"
                      >
                        {workingId === user.id
                          ? "處理中..."
                          : "解除綁定"}
                      </button>
                    ) : (
                      <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
                        <select
                          value={selectedCustomers[user.id] ?? ""}
                          onChange={(event) =>
                            setSelectedCustomers((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          className="min-w-72 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500"
                        >
                          <option value="">
                            選擇要綁定的後結客戶
                          </option>

                          {activeCustomers.map((customer) => (
                            <option
                              key={customer.id}
                              value={customer.id}
                            >
                              {customer.customerCode}｜{customer.name}
                              {customer.lineUserId
                                ? "（已有 LINE）"
                                : ""}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => bindLineUser(user)}
                          disabled={workingId === user.id}
                          className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {workingId === user.id
                            ? "綁定中..."
                            : "確認綁定"}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {hasMore && (
              <button type="button" disabled={fetchingMore}
                onClick={() => void loadPage(cursor)}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold disabled:opacity-50">
                {fetchingMore ? "載入中..." : "載入更多 LINE 使用者（50 筆）"}
              </button>
            )}
            <button type="button" onClick={() => void loadPage(null, true)}
              className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold">
              重新整理已載入名單
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}