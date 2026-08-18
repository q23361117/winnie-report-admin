"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type DispatcherItem = {
  name: string;
  count: number;
};

type AnalyticsPeriod = {
  rideCount: number;
  totalFare: number;
  postpaid: number;
  cancel: number;
  collection: number;
  rideCredit: number;
  discount: number;
  rebate: number;
  unassignedCount: number;
  dispatcherRanking: DispatcherItem[];
};

type DashboardData = {
  analytics?: {
    today: AnalyticsPeriod;
    month: AnalyticsPeriod;
  };
  lastUpdated: string;
};

type ApiResponse = {
  success: boolean;
  data?: DashboardData;
  message?: string;
};

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatClock(date: Date | null) {
  if (!date) {
    return "尚未同步";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

async function fetchAnalyticsData(): Promise<DashboardData> {
  const response = await fetch(
    `/api/dashboard?_live=${Date.now()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const result = (await response.json()) as ApiResponse;

  if (!response.ok) {
    throw new Error(
      result.message ||
        `Dashboard API 回傳錯誤：${response.status}`
    );
  }

  if (!result.success || !result.data) {
    throw new Error(
      result.message ||
        "Dashboard API 沒有回傳有效資料"
    );
  }

  return result.data;
}

export default function AnalyticsPage() {
  const [data, setData] =
    useState<DashboardData | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [lastFetchedAt, setLastFetchedAt] =
    useState<Date | null>(null);

  const loadData = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const result =
          await fetchAnalyticsData();

        setData(result);
        setError("");
        setLastFetchedAt(new Date());
      } catch (err) {
        console.error(
          "讀取調度與財務資料失敗：",
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : "讀取調度與財務資料失敗"
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadData(true);

    const timer = window.setInterval(() => {
      void loadData(false);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadData]);

  async function handleRefresh() {
    if (refreshing) {
      return;
    }

    setRefreshing(true);

    await loadData(false);
  }

  const analytics =
    data?.analytics?.month;

  const cards = useMemo(
    () => [
      {
        title: "本月總車資",
        value: money(
          analytics?.totalFare ?? 0
        ),
        note: "有效派車的總車資加總",
      },
      {
        title: "本月後結金額",
        value: money(
          analytics?.postpaid ?? 0
        ),
        note: "報表後結欄位加總",
      },
      {
        title: "本月回扣金額",
        value: money(
          analytics?.rebate ?? 0
        ),
        note: "報表回扣欄位加總",
      },
      {
        title: "本月取消費",
        value: money(
          analytics?.cancel ?? 0
        ),
        note: "取消欄位金額加總",
      },
      {
        title: "本月代收",
        value: money(
          analytics?.collection ?? 0
        ),
        note: "代收欄位金額加總",
      },
      {
        title: "本月乘車金",
        value: money(
          analytics?.rideCredit ?? 0
        ),
        note: "已使用乘車金加總",
      },
      {
        title: "本月折扣",
        value: money(
          analytics?.discount ?? 0
        ),
        note: "折扣欄位金額加總",
      },
      {
        title: "未填調度",
        value: `${
          analytics?.unassignedCount ?? 0
        } 單`,
        note: "調度欄為空白的有效派車",
      },
    ],
    [analytics]
  );

  const ranking =
    analytics?.dispatcherRanking ?? [];

  const maxCount =
    ranking.length > 0
      ? Math.max(
          ...ranking.map(
            (item) => item.count
          )
        )
      : 1;

  const connected =
    Boolean(data) && !error;

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">

        {/* =========================================
            左側選單
        ========================================= */}

        <aside className="hidden w-64 shrink-0 bg-[#0f1b2d] px-5 py-6 text-white lg:block">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-xl">
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
            <Link
              href="/"
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              ▦　營運總覽
            </Link>

            <Link
              href="/analytics"
              className="block rounded-xl bg-blue-500 px-4 py-3 text-sm font-medium text-white shadow-lg"
            >
              ◫　調度與財務
            </Link>

            <Link
              href="/members"
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              ♙　會員管理
            </Link>

            <Link
              href="/points"
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              ☆　集點紀錄
            </Link>

            <Link
              href="/postpaid"
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              ▤　後結帳務
            </Link>

            <Link
              href="/credits"
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              ▭　乘車金管理
            </Link>
          </nav>

          {/* 左下狀態 */}

          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  connected
                    ? "bg-emerald-400"
                    : loading
                      ? "bg-amber-400"
                      : "bg-red-400"
                }`}
              />

              <p className="text-sm font-semibold">
                {connected
                  ? "5 秒同步中"
                  : loading
                    ? "正在連線"
                    : "連線異常"}
              </p>
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-400">
              調度與財務報表每 5 秒更新一次。
            </p>

            <p className="mt-2 text-[11px] text-slate-500">
              最後抓取：
              {formatClock(
                lastFetchedAt
              )}
            </p>
          </div>
        </aside>

        {/* =========================================
            右側內容
        ========================================= */}

        <section className="min-w-0 flex-1">

          {/* 手機頂部 */}

          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 lg:hidden">
            <div>
              <p className="font-bold">
                維尼車隊
              </p>

              <p className="text-xs text-slate-500">
                調度與財務分析
              </p>
            </div>

            <Link
              href="/"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-blue-600"
            >
              營運總覽
            </Link>
          </div>

          <div className="mx-auto max-w-7xl px-5 py-7 md:px-8">

            {/* =========================================
                標題
            ========================================= */}

            <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-sm font-semibold text-blue-600">
                  報表分析中心
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                  調度與財務分析
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  查看本月調度派單排行及各項財務金額
                </p>

                <div className="mt-4 flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                      connected
                        ? "bg-emerald-50 text-emerald-700"
                        : loading
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        connected
                          ? "bg-emerald-500"
                          : loading
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                    />

                    {connected
                      ? "5 秒同步中"
                      : loading
                        ? "正在連線"
                        : "連線異常"}
                  </span>

                  <span className="text-xs text-slate-400">
                    Google 報表每 5 秒自動同步
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">
                    Apps Script 回報
                  </p>

                  <p className="mt-1 text-sm font-semibold">
                    {data?.lastUpdated ??
                      "尚未取得資料"}
                  </p>

                  <p className="mt-1 text-[11px] text-slate-400">
                    本頁抓取：
                    {formatClock(
                      lastFetchedAt
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    handleRefresh
                  }
                  disabled={
                    refreshing
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="立即重新同步"
                >
                  <span
                    className={
                      refreshing
                        ? "animate-spin"
                        : ""
                    }
                  >
                    ↻
                  </span>
                </button>
              </div>
            </header>

            {/* =========================================
                錯誤
            ========================================= */}

            {error && (
              <section className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-bold text-red-700">
                  ⚠️ 調度與財務資料目前無法同步
                </p>

                <p className="mt-1 text-xs text-red-600">
                  {error}
                </p>
              </section>
            )}

            {/* =========================================
                載入
            ========================================= */}

            {loading && !data && (
              <section className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-700">
                  正在讀取最新調度與財務資料...
                </p>
              </section>
            )}

            {/* =========================================
                財務卡片
            ========================================= */}

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {cards.map((card) => (
                <article
                  key={
                    card.title
                  }
                  className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
                >
                  <p className="text-sm font-medium text-slate-500">
                    {card.title}
                  </p>

                  <p className="mt-4 text-3xl font-bold tracking-tight">
                    {loading &&
                    !data
                      ? "—"
                      : card.value}
                  </p>

                  <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
                    {card.note}
                  </p>
                </article>
              ))}
            </section>

            {/* =========================================
                排行與摘要
            ========================================= */}

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">

              {/* 排行 */}

              <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">
                      本月調度派單排行
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      依本月有效派車單量排序
                    </p>
                  </div>

                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                    共{" "}
                    {analytics?.rideCount ??
                      0}{" "}
                    單
                  </span>
                </div>

                <div className="mt-6 space-y-4">
                  {loading &&
                  !data ? (
                    <div className="rounded-2xl bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">
                      正在讀取調度排行...
                    </div>
                  ) : ranking.length ===
                    0 ? (
                    <div className="rounded-2xl bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">
                      尚未取得調度資料
                    </div>
                  ) : (
                    ranking.map(
                      (
                        item,
                        index
                      ) => {
                        const percentage =
                          maxCount > 0
                            ? (item.count /
                                maxCount) *
                              100
                            : 0;

                        return (
                          <div
                            key={
                              item.name
                            }
                            className="rounded-2xl border border-slate-100 p-4"
                          >
                            <div className="flex items-center gap-4">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
                                {index +
                                  1}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-3">
                                  <p
                                    className={`font-semibold ${
                                      item.name ===
                                      "未填調度"
                                        ? "text-amber-600"
                                        : "text-slate-900"
                                    }`}
                                  >
                                    {
                                      item.name
                                    }
                                  </p>

                                  <p className="font-bold">
                                    {
                                      item.count
                                    }{" "}
                                    單
                                  </p>
                                </div>

                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={`h-full rounded-full ${
                                      item.name ===
                                      "未填調度"
                                        ? "bg-amber-400"
                                        : "bg-blue-500"
                                    }`}
                                    style={{
                                      width: `${percentage}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )
                  )}
                </div>
              </article>

              {/* 摘要 */}

              <article className="rounded-3xl bg-[#0f1b2d] p-6 text-white shadow-sm">
                <p className="text-sm font-medium text-slate-400">
                  本月財務摘要
                </p>

                <p className="mt-3 text-4xl font-bold">
                  {loading &&
                  !data
                    ? "—"
                    : money(
                        analytics?.totalFare ??
                          0
                      )}
                </p>

                <p className="mt-2 text-sm text-slate-400">
                  本月有效派車總車資
                </p>

                <div className="mt-7 space-y-4 border-t border-white/10 pt-6">
                  <SummaryRow
                    label="後結"
                    value={money(
                      analytics?.postpaid ??
                        0
                    )}
                  />

                  <SummaryRow
                    label="回扣"
                    value={money(
                      analytics?.rebate ??
                        0
                    )}
                  />

                  <SummaryRow
                    label="取消費"
                    value={money(
                      analytics?.cancel ??
                        0
                    )}
                  />

                  <SummaryRow
                    label="代收"
                    value={money(
                      analytics?.collection ??
                        0
                    )}
                  />

                  <SummaryRow
                    label="乘車金"
                    value={money(
                      analytics?.rideCredit ??
                        0
                    )}
                  />

                  <SummaryRow
                    label="折扣"
                    value={money(
                      analytics?.discount ??
                        0
                    )}
                  />
                </div>
              </article>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-400">
        {label}
      </span>

      <span className="font-semibold">
        {value}
      </span>
    </div>
  );
}