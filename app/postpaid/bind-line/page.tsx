"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

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
  lastSeenAt?: Timestamp;
};

type PostpaidCustomer = {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  lineUserId: string;
  status: string;
};

function formatDate(value?: Timestamp) {
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
  }).format(value.toDate());
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

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "pendingLineUsers"),
      (snapshot) => {
        const rows = snapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            lineUserId: String(data.lineUserId ?? ""),
            displayName: String(data.displayName ?? ""),
            pictureUrl: String(data.pictureUrl ?? ""),
            statusMessage: String(data.statusMessage ?? ""),
            lastMessage: String(data.lastMessage ?? ""),
            eventType: String(data.eventType ?? ""),
            bindingStatus: String(data.bindingStatus ?? "pending"),
            boundCustomerId: String(data.boundCustomerId ?? ""),
            boundCustomerCode: String(data.boundCustomerCode ?? ""),
            boundCustomerName: String(data.boundCustomerName ?? ""),
            isFriend: Boolean(data.isFriend ?? true),
            lastSeenAt:
              data.lastSeenAt instanceof Timestamp
                ? data.lastSeenAt
                : undefined,
          } satisfies PendingLineUser;
        });

        rows.sort((a, b) => {
          const aTime = a.lastSeenAt?.toMillis() ?? 0;
          const bTime = b.lastSeenAt?.toMillis() ?? 0;
          return bTime - aTime;
        });

        setLineUsers(rows);
        setLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("讀取 LINE 待綁定名單失敗，請檢查 Firestore 權限。");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "postpaidCustomers"),
      (snapshot) => {
        const rows = snapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            customerCode: String(data.customerCode ?? ""),
            name: String(data.name ?? ""),
            phone: String(data.phone ?? ""),
            lineUserId: String(data.lineUserId ?? ""),
            status: String(data.status ?? "active"),
          } satisfies PostpaidCustomer;
        });

        rows.sort((a, b) =>
          a.customerCode.localeCompare(b.customerCode, "zh-TW")
        );

        setCustomers(rows);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("讀取後結客戶名單失敗。");
      }
    );

    return unsubscribe;
  }, []);

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

    if (!customerId) {
      setError("請先選擇要綁定的後結客戶。");
      return;
    }

    const customer = customers.find(
      (item) => item.id === customerId
    );

    if (!customer) {
      setError("找不到選擇的後結客戶。");
      return;
    }

    if (!user.lineUserId) {
      setError("這筆 LINE 使用者資料缺少 lineUserId。");
      return;
    }

    const overwriteMessage =
      customer.lineUserId &&
      customer.lineUserId !== user.lineUserId
        ? `「${customer.customerCode}」目前已綁定其他 LINE，確定要改綁為「${user.displayName || "此使用者"}」嗎？`
        : `確定將「${user.displayName || "此 LINE 使用者"}」綁定到「${customer.customerCode}｜${customer.name}」嗎？`;

    if (!window.confirm(overwriteMessage)) {
      return;
    }

    setWorkingId(user.id);
    setError("");
    setMessage("");

    try {
      const pendingRef = doc(db, "pendingLineUsers", user.id);
      const customerRef = doc(db, "postpaidCustomers", customerId);

      await runTransaction(db, async (transaction) => {
        const [pendingSnapshot, customerSnapshot] = await Promise.all([
          transaction.get(pendingRef),
          transaction.get(customerRef),
        ]);

        if (!pendingSnapshot.exists()) {
          throw new Error("待綁定 LINE 使用者已不存在。");
        }

        if (!customerSnapshot.exists()) {
          throw new Error("後結客戶已不存在。");
        }

        transaction.update(customerRef, {
          lineUserId: user.lineUserId,
          lineDisplayName: user.displayName,
          linePictureUrl: user.pictureUrl,
          lineBoundAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.update(pendingRef, {
          bindingStatus: "bound",
          boundCustomerId: customerId,
          boundCustomerCode: customer.customerCode,
          boundCustomerName: customer.name,
          boundAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setMessage(
        `已將「${user.displayName || "LINE 使用者"}」綁定到「${customer.customerCode}｜${customer.name}」。`
      );

      setSelectedCustomers((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
    } catch (bindError) {
      console.error(bindError);
      setError(
        bindError instanceof Error
          ? bindError.message
          : "LINE 綁定失敗。"
      );
    } finally {
      setWorkingId("");
    }
  }

  async function unbindLineUser(user: PendingLineUser) {
    if (!user.boundCustomerId) {
      setError("這筆資料沒有綁定的後結客戶。");
      return;
    }

    if (
      !window.confirm(
        `確定解除「${user.displayName || "此 LINE 使用者"}」與「${user.boundCustomerCode}」的綁定嗎？`
      )
    ) {
      return;
    }

    setWorkingId(user.id);
    setError("");
    setMessage("");

    try {
      const pendingRef = doc(db, "pendingLineUsers", user.id);
      const customerRef = doc(
        db,
        "postpaidCustomers",
        user.boundCustomerId
      );

      await runTransaction(db, async (transaction) => {
        const [pendingSnapshot, customerSnapshot] = await Promise.all([
          transaction.get(pendingRef),
          transaction.get(customerRef),
        ]);

        if (!pendingSnapshot.exists()) {
          throw new Error("LINE 使用者資料已不存在。");
        }

        if (customerSnapshot.exists()) {
          const customerData = customerSnapshot.data();
          const currentLineUserId = String(
            customerData.lineUserId ?? ""
          );

          if (
            !currentLineUserId ||
            currentLineUserId === user.lineUserId
          ) {
            transaction.update(customerRef, {
              lineUserId: "",
              lineDisplayName: "",
              linePictureUrl: "",
              lineBoundAt: null,
              updatedAt: serverTimestamp(),
            });
          }
        }

        transaction.update(pendingRef, {
          bindingStatus: "pending",
          boundCustomerId: "",
          boundCustomerCode: "",
          boundCustomerName: "",
          boundAt: null,
          updatedAt: serverTimestamp(),
        });
      });

      setMessage("LINE 綁定已解除。");
    } catch (unbindError) {
      console.error(unbindError);
      setError(
        unbindError instanceof Error
          ? unbindError.message
          : "解除綁定失敗。"
      );
    } finally {
      setWorkingId("");
    }
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
              {pendingCount} 位
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
                建議先確認最近訊息與 LINE 顯示名稱，再選擇客戶。
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
        </section>
      </div>
    </main>
  );
}