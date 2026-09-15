"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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
    today?: AnalyticsPeriod;
    month: AnalyticsPeriod;
  };
  lastUpdated?: string;
};

type ApiResponse = {
  success: boolean;
  data?: DashboardData;
  message?: string;
};

type ArchiveMonth = {
  month: string;
  archived?: boolean;
};

type ArchiveListResponse = {
  success: boolean;
  months?: ArchiveMonth[];
  message?: string;
};

type ArchiveDocument = {
  month?: string;
  archived?: boolean;
  archivedAt?: unknown;
  createdAt?: unknown;
  status?: string;
  reportUrl?: string;

  // 我們目前封存 API 的完整快照放在這裡
  data?: DashboardData;

  // 保留相容性
  analytics?: DashboardData["analytics"];
  lastUpdated?: string;
};

type ArchiveDetailResponse = {
  success: boolean;
  month?: string;
  archived?: boolean;
  data?: ArchiveDocument;
  message?: string;
};

const LIVE_VALUE = "live";

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

function formatMonthLabel(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) {
    return month;
  }

  return `${Number(match[1])} 年 ${Number(
    match[2]
  )} 月`;
}

function getCurrentMonth() {
  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
    }
  ).formatToParts(new Date());

  const year =
    parts.find((item) => item.type === "year")
      ?.value ?? "";

  const month =
    parts.find((item) => item.type === "month")
      ?.value ?? "";

  return `${year}-${month}`;
}

async function fetchLiveAnalytics(): Promise<DashboardData> {
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

  const result =
    (await response.json()) as ApiResponse;

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

async function fetchArchiveMonths(): Promise<
  ArchiveMonth[]
> {
  const response = await fetch(
    `/api/report-archives?_live=${Date.now()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const result =
    (await response.json()) as ArchiveListResponse;

  if (!response.ok) {
    throw new Error(
      result.message ||
        `歷史月份 API 回傳錯誤：${response.status}`
    );
  }

  if (!result.success) {
    throw new Error(
      result.message || "讀取歷史月份失敗"
    );
  }

  return Array.isArray(result.months)
    ? result.months
        .filter(
          (item) =>
            item &&
            /^\d{4}-(0[1-9]|1[0-2])$/.test(
              item.month
            )
        )
        .sort((a, b) =>
          b.month.localeCompare(a.month)
        )
    : [];
}

async function fetchArchiveAnalytics(
  month: string
): Promise<DashboardData> {
  const response = await fetch(
    `/api/report-archives/${encodeURIComponent(
      month
    )}?_live=${Date.now()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const result =
    (await response.json()) as ArchiveDetailResponse;

  if (!response.ok) {
    throw new Error(
      result.message ||
        `歷史報表 API 回傳錯誤：${response.status}`
    );
  }

  if (!result.success || !result.data) {
    throw new Error(
      result.message ||
        `找不到 ${month} 的歷史報表`
    );
  }

  const archive = result.data;

  /*
   * 目前你的 Firebase 結構：
   *
   * reportArchives
   *   └─ 2026-09
   *       └─ data
   *           └─ analytics
   *               └─ month
   *
   * 因此正常會走 archive.data。
   *
   * 後面的 archive.analytics 是為了未來
   * 若調整封存格式仍可相容。
   */
  if (
    archive.data?.analytics?.month
  ) {
    return archive.data;
  }

  if (archive.analytics?.month) {
    return {
      analytics: archive.analytics,
      lastUpdated:
        archive.lastUpdated ??
        `${formatMonthLabel(month)} 歷史封存`,
    };
  }

  throw new Error(
    `${formatMonthLabel(
      month
    )} 的封存資料缺少 analytics.month`
  );
}

export default function AnalyticsPage() {
  const [data, setData] =
    useState<DashboardData | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] = useState("");

  const [lastFetchedAt, setLastFetchedAt] =
    useState<Date | null>(null);

  const [selectedMonth, setSelectedMonth] =
    useState(LIVE_VALUE);

  const [archiveMonths, setArchiveMonths] =
    useState<ArchiveMonth[]>([]);

  const [monthsLoading, setMonthsLoading] =
    useState(true);

  const isLive =
    selectedMonth === LIVE_VALUE;

  const currentMonth = getCurrentMonth();

  const selectedLabel = isLive
    ? `${formatMonthLabel(
        currentMonth
      )}｜目前報表`
    : formatMonthLabel(selectedMonth);

  const loadArchiveMonths =
    useCallback(async () => {
      try {
        setMonthsLoading(true);

        const months =
          await fetchArchiveMonths();

        setArchiveMonths(months);
      } catch (err) {
        console.error(
          "讀取歷史月份清單失敗：",
          err
        );
      } finally {
        setMonthsLoading(false);
      }
    }, []);

  const loadData = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const result =
          selectedMonth === LIVE_VALUE
            ? await fetchLiveAnalytics()
            : await fetchArchiveAnalytics(
                selectedMonth
              );

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
    [selectedMonth]
  );

  useEffect(() => {
    void loadArchiveMonths();
  }, [loadArchiveMonths]);

  useEffect(() => {
    setData(null);
    setError("");

    void loadData(true);

    /*
     * 只有目前報表才每 5 秒同步。
     * 歷史報表是 Firebase 快照，
     * 不需要一直重新讀取。
     */
    if (!isLive) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadData(false);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isLive, loadData]);

  async function handleRefresh() {
    if (refreshing) {
      return;
    }

    setRefreshing(true);

    await Promise.all([
      loadData(false),
      loadArchiveMonths(),
    ]);
  }

  const analytics =
    data?.analytics?.month;

  const cards = useMemo(
    () => [
      {
        title: isLive
          ? "本月總車資"
          : `${formatMonthLabel(
              selectedMonth
            )}總車資`,
        value: money(
          analytics?.totalFare ?? 0
        ),
        note: "有效派車的總車資加總",
      },
      {
        title: isLive
          ? "本月後結金額"
          : "歷史後結金額",
        value: money(
          analytics?.postpaid ?? 0
        ),
        note: "報表後結欄位加總",
      },
      {
        title: isLive
          ? "本月回扣金額"
          : "歷史回扣金額",
        value: money(
          analytics?.rebate ?? 0
        ),
        note: "報表回扣欄位加總",
      },
      {
        title: isLive
          ? "本月取消費"
          : "歷史取消費",
        value: money(
          analytics?.cancel ?? 0
        ),
        note: "取消欄位金額加總",
      },
      {
        title: isLive
          ? "本月代收"
          : "歷史代收",
        value: money(
          analytics?.collection ?? 0
        ),
        note: "代收欄位金額加總",
      },
      {
        title: isLive
          ? "本月乘車金"
          : "歷史乘車金",
        value: money(
          analytics?.rideCredit ?? 0
        ),
        note: "已使用乘車金加總",
      },
      {
        title: isLive
          ? "本月折扣"
          : "歷史折扣",
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
    [analytics, isLive, selectedMonth]
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
        {/* 左側選單 */}

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
                    ? isLive
                      ? "bg-emerald-400"
                      : "bg-blue-400"
                    : loading
                      ? "bg-amber-400"
                      : "bg-red-400"
                }`}
              />

              <p className="text-sm font-semibold">
                {connected
                  ? isLive
                    ? "5 秒同步中"
                    : "歷史報表"
                  : loading
                    ? "正在讀取"
                    : "連線異常"}
              </p>
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-400">
              {isLive
                ? "目前月份由 Google 報表每 5 秒自動同步。"
                : `${formatMonthLabel(
                    selectedMonth
                  )} 已從 Firebase 歷史封存讀取。`}
            </p>

            <p className="mt-2 text-[11px] text-slate-500">
              最後抓取：
              {formatClock(lastFetchedAt)}
            </p>
          </div>
        </aside>

        {/* 右側內容 */}

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
            {/* 標題 */}

            <header className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
              <div>
                <p className="text-sm font-semibold text-blue-600">
                  報表分析中心
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                  調度與財務分析
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  查看目前月份及歷史月份的調度派單排行與各項財務金額
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                      connected
                        ? isLive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-blue-50 text-blue-700"
                        : loading
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        connected
                          ? isLive
                            ? "bg-emerald-500"
                            : "bg-blue-500"
                          : loading
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                    />

                    {connected
                      ? isLive
                        ? "5 秒同步中"
                        : "歷史封存"
                      : loading
                        ? "正在讀取"
                        : "連線異常"}
                  </span>

                  <span className="text-xs text-slate-400">
                    {isLive
                      ? "Google 報表每 5 秒自動同步"
                      : "Firebase 歷史報表快照"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                {/* 月份選擇 */}

                <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium text-slate-400">
                    報表月份
                  </p>

                  <select
                    value={selectedMonth}
                    onChange={(event) => {
                      setSelectedMonth(
                        event.target.value
                      );
                    }}
                    disabled={monthsLoading}
                    className="mt-1 w-full cursor-pointer bg-transparent text-sm font-bold text-slate-800 outline-none"
                  >
                    <option value={LIVE_VALUE}>
                      {formatMonthLabel(
                        currentMonth
                      )}{" "}
                      ｜目前報表
                    </option>

                    {archiveMonths.map(
                      (item) => (
                        <option
                          key={item.month}
                          value={item.month}
                        >
                          {formatMonthLabel(
                            item.month
                          )}
                          {item.archived
                            ? "｜已封存"
                            : ""}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {/* 資料來源 */}

                <div className="min-w-[190px] rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">
                    {isLive
                      ? "Apps Script 回報"
                      : "歷史報表"}
                  </p>

                  <p className="mt-1 text-sm font-semibold">
                    {isLive
                      ? data?.lastUpdated ??
                        "尚未取得資料"
                      : selectedLabel}
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
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex h-12 w-12 self-center items-center justify-center rounded-xl border border-slate-200 bg-white text-xl shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-auto"
                  title={
                    isLive
                      ? "立即重新同步"
                      : "重新讀取歷史報表"
                  }
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

            {/* 目前查看月份提示 */}

            <section
              className={`mb-5 rounded-2xl border p-4 ${
                isLive
                  ? "border-emerald-100 bg-emerald-50"
                  : "border-blue-100 bg-blue-50"
              }`}
            >
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <p
                    className={`text-sm font-bold ${
                      isLive
                        ? "text-emerald-700"
                        : "text-blue-700"
                    }`}
                  >
                    {isLive
                      ? `📡 正在查看 ${formatMonthLabel(
                          currentMonth
                        )}即時報表`
                      : `📦 正在查看 ${formatMonthLabel(
                          selectedMonth
                        )}歷史封存`}
                  </p>

                  <p
                    className={`mt-1 text-xs ${
                      isLive
                        ? "text-emerald-600"
                        : "text-blue-600"
                    }`}
                  >
                    {isLive
                      ? "資料持續由目前使用中的 Google 試算表同步。"
                      : "此資料來自 Firebase 封存，不會因之後清空 Google 試算表而改變。"}
                  </p>
                </div>

                {!isLive && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedMonth(
                        LIVE_VALUE
                      )
                    }
                    className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-blue-600 shadow-sm ring-1 ring-blue-100 transition hover:bg-blue-50"
                  >
                    返回目前報表
                  </button>
                )}
              </div>
            </section>

            {/* 錯誤 */}

            {error && (
              <section className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-bold text-red-700">
                  ⚠️ 調度與財務資料目前無法讀取
                </p>

                <p className="mt-1 text-xs text-red-600">
                  {error}
                </p>
              </section>
            )}

            {/* 載入 */}

            {loading && !data && (
              <section className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-700">
                  {isLive
                    ? "正在讀取最新調度與財務資料..."
                    : `正在讀取 ${formatMonthLabel(
                        selectedMonth
                      )}歷史報表...`}
                </p>
              </section>
            )}

            {/* 財務卡片 */}

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {cards.map((card) => (
                <article
                  key={card.title}
                  className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
                >
                  <p className="text-sm font-medium text-slate-500">
                    {card.title}
                  </p>

                  <p className="mt-4 text-3xl font-bold tracking-tight">
                    {loading && !data
                      ? "—"
                      : card.value}
                  </p>

                  <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
                    {card.note}
                  </p>
                </article>
              ))}
            </section>

            {/* 排行與摘要 */}

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
              {/* 排行 */}

              <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">
                      {isLive
                        ? "本月調度派單排行"
                        : `${formatMonthLabel(
                            selectedMonth
                          )}調度派單排行`}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      依所選月份有效派車單量排序
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
                  {loading && !data ? (
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
                      (item, index) => {
                        const percentage =
                          maxCount > 0
                            ? (item.count /
                                maxCount) *
                              100
                            : 0;

                        return (
                          <div
                            key={`${item.name}-${index}`}
                            className="rounded-2xl border border-slate-100 p-4"
                          >
                            <div className="flex items-center gap-4">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
                                {index + 1}
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
                  {isLive
                    ? "本月財務摘要"
                    : `${formatMonthLabel(
                        selectedMonth
                      )}財務摘要`}
                </p>

                <p className="mt-3 text-4xl font-bold">
                  {loading && !data
                    ? "—"
                    : money(
                        analytics?.totalFare ??
                          0
                      )}
                </p>

                <p className="mt-2 text-sm text-slate-400">
                  所選月份有效派車總車資
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

                {!isLive && (
                  <div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold text-blue-300">
                      📦 歷史封存
                    </p>

                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      {formatMonthLabel(
                        selectedMonth
                      )}
                      的數據已保存於
                      Firebase，不受目前 Google
                      報表內容變動影響。
                    </p>
                  </div>
                )}
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