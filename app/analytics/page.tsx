import Link from "next/link";

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

async function getData(): Promise<DashboardData | null> {
  const apiUrl =
    process.env.GOOGLE_SHEETS_API_URL;

  if (!apiUrl) {
    return null;
  }

  try {
    const response = await fetch(apiUrl, {
      next: {
        revalidate: 30,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    const result =
      (await response.json()) as ApiResponse;

    if (!result.success || !result.data) {
      return null;
    }

    return result.data;
  } catch {
    return null;
  }
}

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function AnalyticsPage() {
  const data = await getData();
  const analytics = data?.analytics?.month;

  const cards = [
    {
      title: "本月總車資",
      value: money(analytics?.totalFare ?? 0),
      note: "有效派車的總車資加總",
    },
    {
      title: "本月後結金額",
      value: money(analytics?.postpaid ?? 0),
      note: "報表後結欄位加總",
    },
    {
      title: "本月回扣金額",
      value: money(analytics?.rebate ?? 0),
      note: "報表回扣欄位加總",
    },
    {
      title: "本月取消費",
      value: money(analytics?.cancel ?? 0),
      note: "取消欄位金額加總",
    },
    {
      title: "本月代收",
      value: money(analytics?.collection ?? 0),
      note: "代收欄位金額加總",
    },
    {
      title: "本月乘車金",
      value: money(analytics?.rideCredit ?? 0),
      note: "已使用乘車金加總",
    },
    {
      title: "本月折扣",
      value: money(analytics?.discount ?? 0),
      note: "折扣欄位金額加總",
    },
    {
      title: "未填調度",
      value: `${analytics?.unassignedCount ?? 0} 單`,
      note: "調度欄為空白的有效派車",
    },
  ];

  const ranking =
    analytics?.dispatcherRanking ?? [];

  const maxCount =
    ranking.length > 0
      ? Math.max(
          ...ranking.map((item) => item.count)
        )
      : 1;

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">
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

            <div className="rounded-xl px-4 py-3 text-sm font-medium text-slate-500">
              ▭　乘車金管理
            </div>
          </nav>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-5 py-7 md:px-8">
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
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">
                    最後更新
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {data?.lastUpdated ??
                      "尚未取得資料"}
                  </p>
                </div>

                <Link
                  href="/analytics"
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl shadow-sm"
                  title="重新整理"
                >
                  ↻
                </Link>
              </div>
            </header>

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
                    {card.value}
                  </p>

                  <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
                    {card.note}
                  </p>
                </article>
              ))}
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
              <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">
                      本月調度派單排行
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      依本月有效派車單量排序
                    </p>
                  </div>

                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                    共 {analytics?.rideCount ?? 0} 單
                  </span>
                </div>

                <div className="mt-6 space-y-4">
                  {ranking.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">
                      尚未取得調度資料
                    </div>
                  ) : (
                    ranking.map((item, index) => {
                      const percentage =
                        maxCount > 0
                          ? (item.count / maxCount) *
                            100
                          : 0;

                      return (
                        <div
                          key={item.name}
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
                                  {item.name}
                                </p>

                                <p className="font-bold">
                                  {item.count} 單
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
                    })
                  )}
                </div>
              </article>

              <article className="rounded-3xl bg-[#0f1b2d] p-6 text-white shadow-sm">
                <p className="text-sm font-medium text-slate-400">
                  本月財務摘要
                </p>

                <p className="mt-3 text-4xl font-bold">
                  {money(
                    analytics?.totalFare ?? 0
                  )}
                </p>

                <p className="mt-2 text-sm text-slate-400">
                  本月有效派車總車資
                </p>

                <div className="mt-7 space-y-4 border-t border-white/10 pt-6">
                  <SummaryRow
                    label="後結"
                    value={money(
                      analytics?.postpaid ?? 0
                    )}
                  />

                  <SummaryRow
                    label="回扣"
                    value={money(
                      analytics?.rebate ?? 0
                    )}
                  />

                  <SummaryRow
                    label="取消費"
                    value={money(
                      analytics?.cancel ?? 0
                    )}
                  />

                  <SummaryRow
                    label="折扣"
                    value={money(
                      analytics?.discount ?? 0
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
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">
        {label}
      </span>

      <span className="font-semibold">
        {value}
      </span>
    </div>
  );
}