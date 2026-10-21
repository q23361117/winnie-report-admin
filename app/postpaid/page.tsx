"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type PostpaidCustomer = {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  balance: number;
  openingBalance: number;
  totalRides: number;
  totalPostpaidAmount: number;
  lineUserId: string;
  status: string;
  updatedAt?: Timestamp;
};

const menuItems = [
  { name: "營運總覽", href: "/" },
  { name: "調度與財務", href: "/analytics" },
  { name: "會員管理", href: "/members" },
  { name: "集點紀錄", href: "/points" },
  { name: "後結帳務", href: "/postpaid" },
  { name: "乘車金管理", href: "/credits" },
];

function formatMoney(value: number) {
  return `NT$ ${Number(value || 0).toLocaleString("zh-TW")}`;
}

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

function formatRealtimeClock(value?: Date) {
  if (!value) {
    return "尚未同步";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

export default function PostpaidPage() {
  const [customers, setCustomers] = useState<PostpaidCustomer[]>([]);
  // LINE 待綁定數量以低頻聚合查詢取得，不下載完整 LINE 名單
  const [pendingLineCount, setPendingLineCount] = useState<number | null>(null);
  const [pendingCountError, setPendingCountError] = useState("");
  const [pendingCountUpdatedAt, setPendingCountUpdatedAt] = useState<Date>();

  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [error, setError] = useState("");

  const [customerConnected, setCustomerConnected] =
    useState(false);

  const [lastUpdated, setLastUpdated] = useState<Date>();

  /**
   * =====================================================
   * 後結客戶 Firebase 即時監聽
   * =====================================================
   *
   * Firestore 只要：
   * - 新增客戶
   * - 修改餘額
   * - 修改搭乘次數
   * - 修改後結金額
   * - 綁定 LINE
   * - 修改狀態
   *
   * 畫面就會立即自動更新。
   */
  useEffect(() => {
    setLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, "postpaidCustomers"),

      (snapshot) => {
        const rows = snapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,

            customerCode: String(
              data.customerCode ?? ""
            ),

            name: String(data.name ?? ""),

            phone: String(data.phone ?? ""),

            balance: Number(
              data.balance ?? 0
            ),

            openingBalance: Number(
              data.openingBalance ?? 0
            ),

            totalRides: Number(
              data.totalRides ?? 0
            ),

            totalPostpaidAmount: Number(
              data.totalPostpaidAmount ?? 0
            ),

            lineUserId: String(
              data.lineUserId ?? ""
            ),

            status: String(
              data.status ?? "active"
            ),

            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt
                : undefined,
          } satisfies PostpaidCustomer;
        });

        /**
         * 客戶代號排序
         */
        rows.sort((a, b) =>
          a.customerCode.localeCompare(
            b.customerCode,
            "zh-TW"
          )
        );

        setCustomers(rows);

        setLoading(false);

        setCustomerConnected(true);

        setLastUpdated(new Date());

        setError("");
      },

      (snapshotError) => {
        console.error(
          "讀取後結客戶失敗：",
          snapshotError
        );

        setCustomerConnected(false);

        setError(
          "讀取後結客戶失敗，請檢查 Firestore 權限或網路連線。"
        );

        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  /**
   * =====================================================
   * LINE 待綁定人數：進站讀取一次，每 5 分鐘最多更新一次
   * 隱藏頁面時暫停，避免持續消耗 Firestore 配額
   * =====================================================
   */
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    async function loadPendingCount() {
      if (cancelled || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await fetch("/api/postpaid/pending-count", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json() as {
          success?: boolean;
          pendingCount?: number;
          error?: string;
        };
        if (!response.ok || !result.success ||
            !Number.isSafeInteger(result.pendingCount) ||
            (result.pendingCount ?? -1) < 0) {
          throw new Error(result.error || "LINE 待綁定數量讀取失敗");
        }
        if (cancelled) return;
        setPendingLineCount(result.pendingCount!);
        setPendingCountError("");
        setPendingCountUpdatedAt(new Date());
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          console.error("LINE 待綁定數量讀取失敗：", error);
          setPendingCountError("LINE 待綁定人數暫時無法更新（可能是 Firestore 配額不足）。");
        }
      } finally {
        inFlight = false;
      }
    }

    void loadPendingCount();
    const timer = window.setInterval(() => void loadPendingCount(), 300_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  /**
   * =====================================================
   * 搜尋與狀態篩選
   * =====================================================
   */
  const filteredCustomers = useMemo(() => {
    const normalizedKeyword = keyword
      .trim()
      .toLowerCase();

    return customers.filter((customer) => {
      if (
        statusFilter !== "all" &&
        customer.status !== statusFilter
      ) {
        return false;
      }

      if (!normalizedKeyword) {
        return true;
      }

      return [
        customer.customerCode,
        customer.name,
        customer.phone,
      ].some((value) =>
        value
          .toLowerCase()
          .includes(normalizedKeyword)
      );
    });
  }, [
    customers,
    keyword,
    statusFilter,
  ]);

  /**
   * =====================================================
   * 啟用中的後結客戶
   * =====================================================
   */
  const activeCustomers = useMemo(() => {
    return customers.filter(
      (customer) =>
        customer.status === "active"
    );
  }, [customers]);

  /**
   * =====================================================
   * 帳務餘額總計
   * =====================================================
   */
  const totalBalance = useMemo(() => {
    return activeCustomers.reduce(
      (sum, customer) =>
        sum + customer.balance,
      0
    );
  }, [activeCustomers]);

  /**
   * =====================================================
   * 欠款總額
   * =====================================================
   */
  const totalDebt = useMemo(() => {
    return activeCustomers.reduce(
      (sum, customer) =>
        sum +
        Math.abs(
          Math.min(
            0,
            customer.balance
          )
        ),
      0
    );
  }, [activeCustomers]);

  /**
   * =====================================================
   * 儲值餘額
   * =====================================================
   */
  const totalDeposit = useMemo(() => {
    return activeCustomers.reduce(
      (sum, customer) =>
        sum +
        Math.max(
          0,
          customer.balance
        ),
      0
    );
  }, [activeCustomers]);

  // 僅後結客戶保留真正的 Firestore 即時監聽。
  const realtimeConnected = customerConnected;

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">

        {/* ===================================================
            左側選單
        =================================================== */}
        <aside className="hidden w-64 shrink-0 flex-col bg-[#0f1b2d] px-5 py-6 text-white lg:flex">

          <div className="flex items-center gap-3 px-2">

            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-xl shadow-lg">
              🚕
            </div>

            <div>
              <p className="text-lg font-bold">
                維尼車隊
              </p>

              <p className="text-xs text-slate-400">
                營運管理系統
              </p>
            </div>

          </div>

          <nav className="mt-10 space-y-2">

            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                  item.href === "/postpaid"
                    ? "bg-blue-500 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>
                  {item.name}
                </span>
              </Link>
            ))}

          </nav>

          {/* 即時連線狀態 */}

          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">

            <div className="flex items-center gap-2">

              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  realtimeConnected
                    ? "bg-emerald-400"
                    : "bg-amber-400"
                }`}
              />

              <p className="text-sm font-bold">

                {realtimeConnected
                  ? "即時連線中"
                  : "正在連線"}

              </p>

            </div>

            <p className="mt-2 text-xs text-slate-400">

              Firestore 後結客戶即時監控

            </p>

            <p className="mt-1 text-xs text-slate-500">

              最後同步：
              {formatRealtimeClock(
                lastUpdated
              )}

            </p>

          </div>

        </aside>

        {/* ===================================================
            主內容
        =================================================== */}

        <section className="min-w-0 flex-1">

          <div className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-8">

            {/* =================================================
                頁面標題
            ================================================= */}

            <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">

              <div>

                <p className="text-sm font-semibold text-blue-600">
                  後結帳務系統
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                  後結帳務
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  管理後結客戶、目前餘額與歷史帳務。
                </p>

                {/* 即時監控狀態 */}

                <div className="mt-4 flex flex-wrap items-center gap-3">

                  <div
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                      realtimeConnected
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >

                    <span
                      className={`h-2 w-2 rounded-full ${
                        realtimeConnected
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                      }`}
                    />

                    {realtimeConnected
                      ? "即時監控中"
                      : "正在連線"}

                  </div>

                  <span className="text-xs text-slate-400">

                    最後更新：
                    {formatRealtimeClock(
                      lastUpdated
                    )}

                  </span>

                </div>

              </div>

              <div className="flex flex-col gap-3 sm:flex-row">

                <Link
                  href="/postpaid/bind-line"
                  className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
                >

                  🔗 LINE 待綁定

                  {pendingLineCount !== null && pendingLineCount > 0 && (
                    <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">
                      {pendingLineCount}
                    </span>
                  )}

                </Link>

                <Link
                  href="/postpaid/new"
                  className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  ＋ 新增後結客戶
                </Link>

              </div>

            </header>

            {/* =================================================
                統計卡片
            ================================================= */}

            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

              <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">

                <div className="flex items-center justify-between">

                  <p className="text-sm text-slate-500">
                    後結客戶
                  </p>

                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600">
                    即時
                  </span>

                </div>

                <p className="mt-4 text-3xl font-bold">
                  {activeCustomers.length} 位
                </p>

              </article>

              <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">

                <div className="flex items-center justify-between">

                  <p className="text-sm text-slate-500">
                    帳務餘額合計
                  </p>

                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600">
                    即時
                  </span>

                </div>

                <p className="mt-4 text-3xl font-bold">
                  {formatMoney(
                    totalBalance
                  )}
                </p>

              </article>

              <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">

                <div className="flex items-center justify-between">

                  <p className="text-sm text-slate-500">
                    欠款總額
                  </p>

                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600">
                    即時
                  </span>

                </div>

                <p className="mt-4 text-3xl font-bold text-red-600">
                  {formatMoney(
                    totalDebt
                  )}
                </p>

              </article>

              <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">

                <div className="flex items-center justify-between">

                  <p className="text-sm text-slate-500">
                    儲值餘額
                  </p>

                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600">
                    即時
                  </span>

                </div>

                <p className="mt-4 text-3xl font-bold text-emerald-600">
                  {formatMoney(
                    totalDeposit
                  )}
                </p>

              </article>

            </section>

            {/* =================================================
                LINE 待綁定提醒
            ================================================= */}

            {pendingLineCount !== null && pendingLineCount > 0 && (

              <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                  <div>

                    <p className="font-bold text-emerald-900">
                      有 {pendingLineCount} 位 LINE 使用者等待綁定
                    </p>

                    <p className="mt-1 text-sm text-emerald-700">
                      LINE 人數約每 5 分鐘更新，詳細名單請至綁定頁查詢。
                      {pendingCountUpdatedAt && ` 最後統計：${formatRealtimeClock(pendingCountUpdatedAt)}`}
                    </p>

                  </div>

                  <Link
                    href="/postpaid/bind-line"
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    前往綁定
                  </Link>

                </div>

              </section>

            )}

            {/* =================================================
                錯誤提示
            ================================================= */}

            {pendingCountError && (
              <p role="status" className="mt-3 text-sm text-amber-700">
                {pendingCountError}
              </p>
            )}

            {error && (

              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
                ⚠️ {error}
              </div>

            )}

            {/* =================================================
                後結客戶名單
            ================================================= */}

            <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">

              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

                <div>

                  <div className="flex items-center gap-3">

                    <h2 className="text-xl font-bold">
                      後結客戶名單
                    </h2>

                    {realtimeConnected && (

                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">

                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />

                        LIVE

                      </span>

                    )}

                  </div>

                  <p className="mt-1 text-sm text-slate-500">
                    可搜尋客戶代號、姓名或手機，資料異動會自動更新。
                  </p>

                </div>

                <div className="flex flex-col gap-3 sm:flex-row">

                  <select
                    value={
                      statusFilter
                    }
                    onChange={(
                      event
                    ) =>
                      setStatusFilter(
                        event.target.value
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="all">
                      全部狀態
                    </option>

                    <option value="active">
                      啟用中
                    </option>

                    <option value="disabled">
                      已停用
                    </option>

                  </select>

                  <input
                    value={keyword}
                    onChange={(
                      event
                    ) =>
                      setKeyword(
                        event.target.value
                      )
                    }
                    placeholder="搜尋後結客戶..."
                    className="min-w-64 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />

                </div>

              </div>

              {/* ===============================================
                  表格
              =============================================== */}

              <div className="mt-6 overflow-x-auto">

                <table className="min-w-[950px] w-full text-left">

                  <thead>

                    <tr className="border-b border-slate-200 text-xs text-slate-400">

                      <th className="px-3 py-4">
                        客戶
                      </th>

                      <th className="px-3 py-4">
                        手機
                      </th>

                      <th className="px-3 py-4">
                        目前餘額
                      </th>

                      <th className="px-3 py-4">
                        累積後結
                      </th>

                      <th className="px-3 py-4">
                        搭乘次數
                      </th>

                      <th className="px-3 py-4">
                        LINE
                      </th>

                      <th className="px-3 py-4">
                        狀態
                      </th>

                      <th className="px-3 py-4">
                        最後更新
                      </th>

                      <th className="px-3 py-4">
                        操作
                      </th>

                    </tr>

                  </thead>

                  <tbody>

                    {loading ? (

                      <tr>

                        <td
                          colSpan={9}
                          className="px-3 py-12 text-center text-sm text-slate-500"
                        >

                          <div className="flex flex-col items-center justify-center gap-3">

                            <div className="h-7 w-7 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />

                            <span>
                              正在連接即時資料...
                            </span>

                          </div>

                        </td>

                      </tr>

                    ) : filteredCustomers.length === 0 ? (

                      <tr>

                        <td
                          colSpan={9}
                          className="px-3 py-12 text-center text-sm text-slate-500"
                        >
                          尚無符合條件的後結客戶
                        </td>

                      </tr>

                    ) : (

                      filteredCustomers.map(
                        (customer) => (

                          <tr
                            key={
                              customer.id
                            }
                            className="border-b border-slate-100 text-sm transition hover:bg-slate-50"
                          >

                            <td className="px-3 py-5">

                              <p className="font-bold">
                                {customer.name ||
                                  "未填姓名"}
                              </p>

                              <p className="mt-1 text-xs font-semibold text-blue-600">
                                {
                                  customer.customerCode
                                }
                              </p>

                            </td>

                            <td className="px-3 py-5 text-slate-600">
                              {customer.phone ||
                                "—"}
                            </td>

                            <td
                              className={`px-3 py-5 font-bold ${
                                customer.balance <
                                0
                                  ? "text-red-600"
                                  : customer.balance >
                                      0
                                    ? "text-emerald-600"
                                    : "text-slate-800"
                              }`}
                            >
                              {formatMoney(
                                customer.balance
                              )}
                            </td>

                            <td className="px-3 py-5">
                              {formatMoney(
                                customer.totalPostpaidAmount
                              )}
                            </td>

                            <td className="px-3 py-5">
                              {
                                customer.totalRides
                              }{" "}
                              次
                            </td>

                            <td className="px-3 py-5">

                              <span
                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                  customer.lineUserId
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {customer.lineUserId
                                  ? "已綁定"
                                  : "尚未綁定"}
                              </span>

                            </td>

                            <td className="px-3 py-5">

                              <span
                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                  customer.status ===
                                  "active"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {customer.status ===
                                "active"
                                  ? "啟用中"
                                  : "已停用"}
                              </span>

                            </td>

                            <td className="px-3 py-5 text-xs text-slate-500">
                              {formatDate(
                                customer.updatedAt
                              )}
                            </td>

                            <td className="px-3 py-5">

                              <Link
                                href={`/postpaid/${customer.id}`}
                                className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-100"
                              >
                                查看帳務
                              </Link>

                            </td>

                          </tr>

                        )
                      )

                    )}

                  </tbody>

                </table>

              </div>

              {/* ===============================================
                  底部即時狀態
              =============================================== */}

              {!loading && (

                <div className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">

                  <span>
                    共{" "}
                    {
                      filteredCustomers.length
                    }{" "}
                    筆資料
                  </span>

                  <span>

                    {realtimeConnected
                      ? `🟢 即時監控中｜最後更新 ${formatRealtimeClock(
                          lastUpdated
                        )}`
                      : "🟡 即時連線確認中"}

                  </span>

                </div>

              )}

            </section>

          </div>

        </section>

      </div>

    </main>
  );
}