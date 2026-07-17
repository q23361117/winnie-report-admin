import Link from "next/link";
import {
  collection,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type RecentMemberRide = {
  row: number;
  date: string;
  customerCode: string;
  orderContent: string;
  plate: string;
};

type MemberSyncStatus = {
  enabled?: boolean;
  lineNotified?: number;
  lineSkipped?: number;
  lineErrors?: number;
  errors?: number;
};

type PostpaidSyncStatus = {
  enabled?: boolean;
  scanned?: number;
  candidates?: number;
  charged?: number;
  restored?: number;
  reversed?: number;
  duplicates?: number;
  customerNotFound?: number;
  skippedNoAmount?: number;
  lineNotified?: number;
  lineSkipped?: number;
  lineErrors?: number;
  errors?: number;
};

type DashboardData = {
  sheetName: string;
  todayCount: number;
  monthCount: number;
  memberRideCount: number;
  totalRows: number;
  recentMemberRides: RecentMemberRide[];
  memberSync?: MemberSyncStatus;
  postpaidSync?: PostpaidSyncStatus;
  lastUpdated: string;
};


type MemberStats = {
  connected: boolean;
  memberCount: number;
  todayPoints: number;
  monthRewardAmount: number;
  postpaidCustomerCount: number;
  postpaidTotalBalance: number;
};

function getTaipeiDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getTaipeiMonthKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

function getDateFromValue(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  return null;
}

async function getMemberStats(): Promise<MemberStats> {
  try {
    const [
      membersSnapshot,
      pointsSnapshot,
      rideCreditSnapshot,
      postpaidCustomersSnapshot,
    ] = await Promise.all([
      getDocs(collection(db, "members")),
      getDocs(collection(db, "pointTransactions")),
      getDocs(collection(db, "rideCreditTransactions")),
      getDocs(collection(db, "postpaidCustomers")),
    ]);

    const now = new Date();
    const todayKey = getTaipeiDateKey(now);
    const monthKey = getTaipeiMonthKey(now);

    let todayPoints = 0;

    pointsSnapshot.docs.forEach((recordDocument) => {
      const data = recordDocument.data();
      const status = String(data.status ?? "active");

      if (status === "reversed") {
        return;
      }

      const createdAt = getDateFromValue(data.createdAt);

      if (
        createdAt &&
        getTaipeiDateKey(createdAt) === todayKey
      ) {
        todayPoints += Number(data.points ?? 0);
      }
    });

    let monthRewardAmount = 0;

    rideCreditSnapshot.docs.forEach((recordDocument) => {
      const data = recordDocument.data();
      const status = String(data.status ?? "active");
      const amount = Number(data.amount ?? 0);

      if (status === "reversed" || amount <= 0) {
        return;
      }

      const createdAt = getDateFromValue(data.createdAt);

      if (
        createdAt &&
        getTaipeiMonthKey(createdAt) === monthKey
      ) {
        monthRewardAmount += amount;
      }
    });

    let postpaidTotalBalance = 0;

    postpaidCustomersSnapshot.docs.forEach((customerDocument) => {
      const data = customerDocument.data();
      const status = String(data.status ?? "active");

      if (status !== "active") {
        return;
      }

      postpaidTotalBalance += Number(data.balance ?? 0);
    });

    return {
      connected: true,
      memberCount: membersSnapshot.size,
      todayPoints,
      monthRewardAmount,
      postpaidCustomerCount: postpaidCustomersSnapshot.size,
      postpaidTotalBalance,
    };
  } catch (error) {
    console.error("讀取會員統計失敗：", error);

    return {
      connected: false,
      memberCount: 0,
      todayPoints: 0,
      monthRewardAmount: 0,
      postpaidCustomerCount: 0,
      postpaidTotalBalance: 0,
    };
  }
}

type DashboardApiResponse = {
  success: boolean;
  data?: DashboardData;
  message?: string;
};

type MenuItem = {
  name: string;
  href?: string;
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
};

async function getDashboardData(): Promise<DashboardData | null> {
  const apiUrl = process.env.GOOGLE_SHEETS_API_URL;

  if (!apiUrl) {
    console.error("尚未設定 GOOGLE_SHEETS_API_URL");
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
      throw new Error(`Google 試算表 API 回傳錯誤：${response.status}`);
    }

    const result = (await response.json()) as DashboardApiResponse;

    if (!result.success || !result.data) {
      throw new Error(result.message || "Google 試算表沒有回傳有效資料");
    }

    return result.data;
  } catch (error) {
    console.error("讀取 Google 試算表失敗：", error);
    return null;
  }
}

const menuItems: MenuItem[] = [
  {
    name: "營運總覽",
    href: "/",
    active: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </svg>
    ),
  },
  {
    name: "調度與財務",
    href: "/analytics",
    active: false,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M22 19V3" />
        <path d="M2 19h20" />
      </svg>
    ),
  },
  {
    name: "會員管理",
    href: "/members",
    active: false,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    name: "集點紀錄",
    href: "/points",
    active: false,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <path d="M12 2l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 16.82 6.2 19.87l1.11-6.47-4.7-4.58 6.49-.94L12 2z" />
      </svg>
    ),
  },
  {
    name: "後結帳務",
    href: "/postpaid",
    active: false,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <path d="M6 2h9l3 3v17H6z" />
        <path d="M15 2v4h4" />
        <path d="M9 11h6" />
        <path d="M9 15h6" />
        <path d="M9 19h4" />
      </svg>
    ),
  },
  {
    name: "乘車金管理",
    href: "/credits",
    active: false,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <rect x="2" y="5" width="20" height="14" rx="3" />
        <path d="M2 10h20" />
        <path d="M7 15h2" />
      </svg>
    ),
  },
  {
    name: "系統設定",
    active: false,
    disabled: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.12.6.6 1.06 1.2 1.15H21a2 2 0 1 1 0 4h-.09c-.6.09-1.08.55-1.51.85z" />
      </svg>
    ),
  },
];

export default async function Home() {
  const [dashboard, memberStats] = await Promise.all([
    getDashboardData(),
    getMemberStats(),
  ]);

  const isConnected = dashboard !== null;
  const todayCount = dashboard?.todayCount ?? 0;
  const monthCount = dashboard?.monthCount ?? 0;
  const lastUpdated = dashboard?.lastUpdated ?? "尚未取得資料";
  const sheetName = dashboard?.sheetName ?? "Google 試算表";

  const memberSync = dashboard?.memberSync;
  const lineNotified = Number(memberSync?.lineNotified ?? 0);
  const lineSkipped = Number(memberSync?.lineSkipped ?? 0);
  const lineErrors = Number(memberSync?.lineErrors ?? 0);

  const lineConnected =
    Boolean(dashboard) &&
    Boolean(memberSync?.enabled) &&
    lineErrors === 0;

  const lineDescription = !dashboard
    ? "目前無法讀取 Apps Script 報表 API。"
    : !memberSync
      ? "Apps Script 尚未回傳 LINE 通知狀態。"
      : lineErrors > 0
        ? `本次同步有 ${lineErrors} 筆 LINE 通知失敗，請查看 Apps Script 執行記錄。`
        : `LINE 通知功能已啟用；本次成功 ${lineNotified} 筆、略過 ${lineSkipped} 筆、失敗 ${lineErrors} 筆。`;

  const postpaidSync = dashboard?.postpaidSync;
  const postpaidConnected =
    Boolean(dashboard) &&
    Boolean(postpaidSync?.enabled) &&
    Number(postpaidSync?.errors ?? 0) === 0;

  const postpaidDescription = !dashboard
    ? "目前無法讀取 Apps Script 報表 API。"
    : !postpaidSync
      ? "Apps Script 尚未回傳後結帳務同步狀態。"
      : Number(postpaidSync.errors ?? 0) > 0
        ? `本次同步有 ${Number(postpaidSync.errors ?? 0)} 筆後結帳務錯誤。`
        : `本次新增 ${Number(postpaidSync.charged ?? 0)} 筆、恢復 ${Number(postpaidSync.restored ?? 0)} 筆、撤回 ${Number(postpaidSync.reversed ?? 0)} 筆。`;

  const stats = [
    {
      title: "會員總數",
      value: String(memberStats.memberCount),
      note: memberStats.connected
        ? "Firestore 會員資料庫即時統計"
        : "無法讀取會員資料庫",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-6 w-6"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6" />
          <path d="M22 11h-6" />
        </svg>
      ),
    },
    {
      title: "今日新增點數",
      value: String(memberStats.todayPoints),
      note: memberStats.connected
        ? "今天有效集點紀錄加總"
        : "無法讀取集點紀錄",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-6 w-6"
        >
          <path d="M12 2l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 16.82 6.2 19.87l1.11-6.47-4.7-4.58 6.49-.94L12 2z" />
        </svg>
      ),
    },
    {
      title: "後結客戶",
      value: String(memberStats.postpaidCustomerCount),
      note: memberStats.connected
        ? `目前帳務餘額合計 NT$ ${memberStats.postpaidTotalBalance.toLocaleString("zh-TW")}`
        : "無法讀取後結客戶資料",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-6 w-6"
        >
          <path d="M6 2h9l3 3v17H6z" />
          <path d="M15 2v4h4" />
          <path d="M9 11h6" />
          <path d="M9 15h6" />
          <path d="M9 19h4" />
        </svg>
      ),
    },
    {
      title: "本月轉換乘車金",
      value: `NT$ ${memberStats.monthRewardAmount.toLocaleString("zh-TW")}`,
      note: "本月有效乘車金入帳加總",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-6 w-6"
        >
          <rect x="2" y="5" width="20" height="14" rx="3" />
          <path d="M2 10h20" />
          <path d="M7 15h2" />
        </svg>
      ),
    },
  ];

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col bg-[#0f1b2d] px-5 py-6 text-white lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 shadow-lg shadow-blue-950/30">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-6 w-6"
              >
                <path d="M5 17h14" />
                <path d="M6 17l1.5-6h9L18 17" />
                <path d="M9 11V8h6v3" />
                <circle cx="8" cy="18" r="2" />
                <circle cx="16" cy="18" r="2" />
              </svg>
            </div>

            <div>
              <p className="text-lg font-bold">維尼車隊</p>
              <p className="text-xs text-slate-400">營運管理系統</p>
            </div>
          </div>

          <nav className="mt-10 space-y-2">
            {menuItems.map((item) => {
              const className = `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                item.active
                  ? "bg-blue-500 text-white shadow-lg shadow-blue-950/20"
                  : item.disabled
                    ? "cursor-not-allowed text-slate-600"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`;

              if (item.href && !item.disabled) {
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={className}
                  >
                    {item.icon}
                    <span>{item.name}</span>
                  </Link>
                );
              }

              return (
                <div key={item.name} className={className}>
                  {item.icon}
                  <span>{item.name}</span>

                  {item.disabled && (
                    <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-500">
                      建置中
                    </span>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isConnected ? "bg-emerald-400" : "bg-red-400"
                }`}
              />

              <p className="text-sm font-semibold">
                {isConnected ? "報表連接正常" : "報表連接失敗"}
              </p>
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-400">
              {isConnected
                ? `目前正在同步「${sheetName}」報表。`
                : "請檢查 Apps Script API 或環境變數設定。"}
            </p>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                >
                  <path d="M5 17h14" />
                  <path d="M6 17l1.5-6h9L18 17" />
                  <path d="M9 11V8h6v3" />
                  <circle cx="8" cy="18" r="2" />
                  <circle cx="16" cy="18" r="2" />
                </svg>
              </div>

              <div>
                <p className="font-bold">維尼車隊後台</p>
                <p className="text-xs text-slate-500">營運管理系統</p>
              </div>
            </div>

            <Link
              href="/analytics"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-blue-600"
            >
              調度與財務
            </Link>
          </div>

          <div className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-8">
            <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-sm font-semibold text-blue-600">
                  營運管理中心
                </p>

                <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
                  營運總覽
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  查看車隊單量、會員集點、後結帳務與乘車金使用狀況
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">資料更新狀態</p>

                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isConnected ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    />

                    <span className="text-sm font-semibold text-slate-700">
                      {isConnected ? "報表連接正常" : "報表連接失敗"}
                    </span>
                  </div>
                </div>

                <Link
                  href="/"
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
                  aria-label="重新整理"
                  title="重新整理資料"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-5 w-5"
                  >
                    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
                    <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                  </svg>
                </Link>
              </div>
            </header>

            <section className="grid gap-5 md:grid-cols-2">
              <article className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 to-blue-800 p-7 text-white shadow-xl shadow-blue-900/15">
                <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
                <div className="absolute -bottom-16 right-14 h-36 w-36 rounded-full bg-white/5" />

                <div className="relative">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-100">
                        今日有效單量
                      </p>

                      <div className="mt-5 flex items-end gap-2">
                        <span className="text-6xl font-bold tracking-tight">
                          {todayCount}
                        </span>

                        <span className="pb-2 text-lg text-blue-100">單</span>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white/15 p-3 backdrop-blur">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-7 w-7"
                      >
                        <path d="M5 17h14" />
                        <path d="M6 17l1.5-6h9L18 17" />
                        <path d="M9 11V8h6v3" />
                        <circle cx="8" cy="18" r="2" />
                        <circle cx="16" cy="18" r="2" />
                      </svg>
                    </div>
                  </div>

                  <div className="mt-8 flex items-center gap-2 border-t border-white/15 pt-4 text-sm text-blue-100">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isConnected ? "bg-emerald-300" : "bg-red-300"
                      }`}
                    />

                    {isConnected
                      ? `已同步「${sheetName}」報表`
                      : "無法連接 Google 試算表"}
                  </div>
                </div>
              </article>

              <article className="relative overflow-hidden rounded-3xl bg-white p-7 shadow-sm ring-1 ring-slate-200/70">
                <div className="absolute right-0 top-0 h-36 w-36 rounded-bl-full bg-blue-50" />

                <div className="relative">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        本月有效單量
                      </p>

                      <div className="mt-5 flex items-end gap-2">
                        <span className="text-6xl font-bold tracking-tight text-slate-900">
                          {monthCount}
                        </span>

                        <span className="pb-2 text-lg text-slate-400">單</span>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-7 w-7"
                      >
                        <rect x="3" y="4" width="18" height="17" rx="2" />
                        <path d="M8 2v4" />
                        <path d="M16 2v4" />
                        <path d="M3 9h18" />
                      </svg>
                    </div>
                  </div>

                  <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-500">
                      本月累積有效派車數量
                    </p>

                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                      本月
                    </span>
                  </div>
                </div>
              </article>
            </section>

            <section className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <article
                  key={stat.title}
                  className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        {stat.title}
                      </p>

                      <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                        {stat.value}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
                      {stat.icon}
                    </div>
                  </div>

                  <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
                    {stat.note}
                  </p>
                </article>
              ))}
            </section>

            <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70 md:p-7">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-slate-900">
                      系統連接狀態
                    </h2>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        isConnected
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {isConnected ? "報表已連接" : "連接失敗"}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-500">
                    {isConnected
                      ? "Google 試算表已成功連接，重新整理頁面即可取得最新資料。"
                      : "目前無法取得報表資料，請檢查 Apps Script 部署及環境變數。"}
                  </p>
                </div>

                <p className="text-xs text-slate-400">
                  最後更新：{lastUpdated}
                </p>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatusCard
                  title="Google 試算表"
                  description={
                    isConnected
                      ? `目前同步分頁：${sheetName}`
                      : "無法讀取每日派車報表"
                  }
                  status={isConnected ? "已連接" : "連接失敗"}
                  connected={isConnected}
                />

                <StatusCard
                  title="會員集點系統"
                  description={
                    memberStats.connected
                      ? `目前共有 ${memberStats.memberCount} 位會員，報表成功派車後自動增加點數。`
                      : "目前無法讀取 Firestore 會員與集點資料。"
                  }
                  status={
                    memberStats.connected
                      ? "已啟用"
                      : "連接失敗"
                  }
                  connected={memberStats.connected}
                />

                <StatusCard
                  title="後結帳務系統"
                  description={postpaidDescription}
                  status={
                    postpaidConnected
                      ? "已啟用"
                      : Number(postpaidSync?.errors ?? 0) > 0
                        ? "同步異常"
                        : "尚未確認"
                  }
                  connected={postpaidConnected}
                />

                <StatusCard
                  title="LINE 官方通知"
                  description={lineDescription}
                  status={
                    lineConnected
                      ? "已連接"
                      : lineErrors > 0
                        ? "通知異常"
                        : "尚未確認"
                  }
                  connected={lineConnected}
                />
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusCard({
  title,
  description,
  status,
  connected,
}: {
  title: string;
  description: string;
  status: string;
  connected: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ${
            connected ? "text-emerald-600" : "text-slate-500"
          }`}
        >
          {connected ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M4.93 4.93l2.83 2.83" />
              <path d="M16.24 16.24l2.83 2.83" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="M4.93 19.07l2.83-2.83" />
              <path d="M16.24 7.76l2.83-2.83" />
            </svg>
          )}
        </div>

        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            connected
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-200 text-slate-600"
          }`}
        >
          {status}
        </span>
      </div>

      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>

      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </article>
  );
}