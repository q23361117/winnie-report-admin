"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  collection,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

/* =========================================================
   型別
========================================================= */

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

type DashboardApiResponse = {
  success: boolean;
  data?: DashboardData;
  message?: string;
};

type MemberRecord = {
  id: string;
};

type PointTransactionRecord = {
  id: string;
  points: number;
  status: string;
  createdAt: Date | null;
};

type RideCreditTransactionRecord = {
  id: string;
  amount: number;
  status: string;
  createdAt: Date | null;
};

type PostpaidCustomerRecord = {
  id: string;
  balance: number;
  status: string;
};

type MenuItem = {
  name: string;
  href?: string;
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
};

/* =========================================================
   台北時間
========================================================= */

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

function formatTaipeiClock(date?: Date | null) {
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

function formatTaipeiDateTime(date?: Date | null) {
  if (!date) {
    return "尚未同步";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/* =========================================================
   Firebase 時間轉換
========================================================= */

function getDateFromValue(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (
        value as {
          toDate: () => Date;
        }
      ).toDate();
    } catch {
      return null;
    }
  }

  return null;
}

/* =========================================================
   數字處理
========================================================= */

function toSafeNumber(value: unknown) {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return numberValue;
}

function formatMoney(value: number) {
  return `NT$ ${Number(value || 0).toLocaleString("zh-TW")}`;
}

/* =========================================================
   Google 試算表 API
   改由 Next.js Server API 代理，避免瀏覽器直接呼叫 Apps Script
========================================================= */

async function fetchDashboardData() {
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
    (await response.json()) as DashboardApiResponse;

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

/* =========================================================
   左側選單
========================================================= */

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

/* =========================================================
   首頁
========================================================= */

export default function Home() {
  /* -------------------------------------------------------
     Google 試算表
  ------------------------------------------------------- */

  const [dashboard, setDashboard] =
    useState<DashboardData | null>(null);

  const [dashboardLoading, setDashboardLoading] =
    useState(true);

  const [dashboardError, setDashboardError] =
    useState("");

  const [dashboardLastFetch, setDashboardLastFetch] =
    useState<Date | null>(null);

  const [dashboardRefreshing, setDashboardRefreshing] =
    useState(false);

  /* -------------------------------------------------------
     Firestore
  ------------------------------------------------------- */

  const [members, setMembers] = useState<
    MemberRecord[]
  >([]);

  const [pointTransactions, setPointTransactions] =
    useState<PointTransactionRecord[]>([]);

  const [
    rideCreditTransactions,
    setRideCreditTransactions,
  ] = useState<RideCreditTransactionRecord[]>([]);

  const [
    postpaidCustomers,
    setPostpaidCustomers,
  ] = useState<PostpaidCustomerRecord[]>([]);

  const [membersLoaded, setMembersLoaded] =
    useState(false);

  const [pointsLoaded, setPointsLoaded] =
    useState(false);

  const [creditsLoaded, setCreditsLoaded] =
    useState(false);

  const [postpaidLoaded, setPostpaidLoaded] =
    useState(false);

  const [firestoreError, setFirestoreError] =
    useState("");

  const [firestoreLastUpdated, setFirestoreLastUpdated] =
    useState<Date | null>(null);

  const mountedRef = useRef(true);

  /* =======================================================
     Google 試算表 5 秒自動同步
  ======================================================= */

  useEffect(() => {
    mountedRef.current = true;

    let running = false;

    const loadDashboard = async (
      showLoading = false
    ) => {
      if (running) {
        return;
      }

      running = true;

      if (showLoading) {
        setDashboardLoading(true);
      }

      try {
        const data =
          await fetchDashboardData();

        if (!mountedRef.current) {
          return;
        }

        setDashboard(data);

        setDashboardError("");

        setDashboardLastFetch(
          new Date()
        );
      } catch (error) {
        console.error(
          "讀取 Google 試算表失敗：",
          error
        );

        if (!mountedRef.current) {
          return;
        }

        setDashboardError(
          error instanceof Error
            ? error.message
            : "讀取 Google 試算表失敗"
        );
      } finally {
        if (mountedRef.current) {
          setDashboardLoading(false);
          setDashboardRefreshing(false);
        }

        running = false;
      }
    };

    void loadDashboard(true);

    /**
     * 每 5 秒自動更新 Google Sheet
     *
     * Firestore 不需要這個，
     * 因為 Firestore 是 onSnapshot 真正即時監聽。
     */
    const timer = window.setInterval(() => {
      void loadDashboard(false);
    }, 5000);

    return () => {
      mountedRef.current = false;

      window.clearInterval(timer);
    };
  }, []);

  /* =======================================================
     Firestore：會員即時監聽
  ======================================================= */

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "members"),

      (snapshot) => {
        const rows =
          snapshot.docs.map((document) => ({
            id: document.id,
          }));

        setMembers(rows);

        setMembersLoaded(true);

        setFirestoreError("");

        setFirestoreLastUpdated(
          new Date()
        );
      },

      (error) => {
        console.error(
          "會員即時監聽失敗：",
          error
        );

        setMembersLoaded(false);

        setFirestoreError(
          "Firestore 部分資料監聽失敗，請檢查權限或網路。"
        );
      }
    );

    return unsubscribe;
  }, []);

  /* =======================================================
     Firestore：集點紀錄即時監聽
  ======================================================= */

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(
        db,
        "pointTransactions"
      ),

      (snapshot) => {
        const rows =
          snapshot.docs.map(
            (document) => {
              const data =
                document.data();

              return {
                id: document.id,

                points: toSafeNumber(
                  data.points
                ),

                status: String(
                  data.status ??
                    "active"
                ),

                createdAt:
                  getDateFromValue(
                    data.createdAt
                  ),
              };
            }
          );

        setPointTransactions(
          rows
        );

        setPointsLoaded(true);

        setFirestoreError("");

        setFirestoreLastUpdated(
          new Date()
        );
      },

      (error) => {
        console.error(
          "集點紀錄即時監聽失敗：",
          error
        );

        setPointsLoaded(false);

        setFirestoreError(
          "Firestore 部分資料監聽失敗，請檢查權限或網路。"
        );
      }
    );

    return unsubscribe;
  }, []);

  /* =======================================================
     Firestore：乘車金即時監聽
  ======================================================= */

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(
        db,
        "rideCreditTransactions"
      ),

      (snapshot) => {
        const rows =
          snapshot.docs.map(
            (document) => {
              const data =
                document.data();

              return {
                id: document.id,

                amount: toSafeNumber(
                  data.amount
                ),

                status: String(
                  data.status ??
                    "active"
                ),

                createdAt:
                  getDateFromValue(
                    data.createdAt
                  ),
              };
            }
          );

        setRideCreditTransactions(
          rows
        );

        setCreditsLoaded(true);

        setFirestoreError("");

        setFirestoreLastUpdated(
          new Date()
        );
      },

      (error) => {
        console.error(
          "乘車金即時監聽失敗：",
          error
        );

        setCreditsLoaded(false);

        setFirestoreError(
          "Firestore 部分資料監聽失敗，請檢查權限或網路。"
        );
      }
    );

    return unsubscribe;
  }, []);

  /* =======================================================
     Firestore：後結帳務即時監聽
  ======================================================= */

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(
        db,
        "postpaidCustomers"
      ),

      (snapshot) => {
        const rows =
          snapshot.docs.map(
            (document) => {
              const data =
                document.data();

              return {
                id: document.id,

                balance:
                  toSafeNumber(
                    data.balance
                  ),

                status: String(
                  data.status ??
                    "active"
                ),
              };
            }
          );

        setPostpaidCustomers(
          rows
        );

        setPostpaidLoaded(true);

        setFirestoreError("");

        setFirestoreLastUpdated(
          new Date()
        );
      },

      (error) => {
        console.error(
          "後結帳務即時監聽失敗：",
          error
        );

        setPostpaidLoaded(false);

        setFirestoreError(
          "Firestore 部分資料監聽失敗，請檢查權限或網路。"
        );
      }
    );

    return unsubscribe;
  }, []);

  /* =======================================================
     Firestore 即時計算
  ======================================================= */

  const firestoreConnected =
    membersLoaded &&
    pointsLoaded &&
    creditsLoaded &&
    postpaidLoaded &&
    !firestoreError;

  const memberCount =
    members.length;

  const todayPoints =
    useMemo(() => {
      const now = new Date();

      const todayKey =
        getTaipeiDateKey(now);

      return pointTransactions.reduce(
        (sum, record) => {
          if (
            record.status ===
            "reversed"
          ) {
            return sum;
          }

          if (!record.createdAt) {
            return sum;
          }

          if (
            getTaipeiDateKey(
              record.createdAt
            ) !== todayKey
          ) {
            return sum;
          }

          return (
            sum +
            Number(
              record.points || 0
            )
          );
        },
        0
      );
    }, [pointTransactions]);

  const monthRewardAmount =
    useMemo(() => {
      const now = new Date();

      const monthKey =
        getTaipeiMonthKey(now);

      return rideCreditTransactions.reduce(
        (sum, record) => {
          if (
            record.status ===
            "reversed"
          ) {
            return sum;
          }

          if (
            record.amount <= 0
          ) {
            return sum;
          }

          if (!record.createdAt) {
            return sum;
          }

          if (
            getTaipeiMonthKey(
              record.createdAt
            ) !== monthKey
          ) {
            return sum;
          }

          return (
            sum +
            record.amount
          );
        },
        0
      );
    }, [
      rideCreditTransactions,
    ]);

  const activePostpaidCustomers =
    useMemo(() => {
      return postpaidCustomers.filter(
        (customer) =>
          customer.status ===
          "active"
      );
    }, [postpaidCustomers]);

  const postpaidCustomerCount =
    activePostpaidCustomers.length;

  const postpaidTotalBalance =
    useMemo(() => {
      return activePostpaidCustomers.reduce(
        (sum, customer) =>
          sum +
          customer.balance,
        0
      );
    }, [
      activePostpaidCustomers,
    ]);

  /* =======================================================
     Google Sheet 狀態
  ======================================================= */

  const isConnected =
    dashboard !== null &&
    !dashboardError;

  const todayCount =
    dashboard?.todayCount ??
    0;

  const monthCount =
    dashboard?.monthCount ??
    0;

  const sheetName =
    dashboard?.sheetName ??
    "Google 試算表";

  const lastUpdated =
    dashboard?.lastUpdated ??
    "尚未取得資料";

  /* =======================================================
     LINE 狀態
  ======================================================= */

  const memberSync =
    dashboard?.memberSync;

  const lineNotified =
    Number(
      memberSync?.lineNotified ??
        0
    );

  const lineSkipped =
    Number(
      memberSync?.lineSkipped ??
        0
    );

  const lineErrors =
    Number(
      memberSync?.lineErrors ??
        0
    );

  const lineConnected =
    Boolean(dashboard) &&
    Boolean(
      memberSync?.enabled
    ) &&
    lineErrors === 0;

  const lineDescription =
    !dashboard
      ? "目前無法讀取 Apps Script 報表 API。"
      : !memberSync
        ? "Apps Script 尚未回傳 LINE 通知狀態。"
        : lineErrors > 0
          ? `本次同步有 ${lineErrors} 筆 LINE 通知失敗，請查看 Apps Script 執行記錄。`
          : `LINE 通知功能已啟用；本次成功 ${lineNotified} 筆、略過 ${lineSkipped} 筆、失敗 ${lineErrors} 筆。`;

  /* =======================================================
     後結同步狀態
  ======================================================= */

  const postpaidSync =
    dashboard?.postpaidSync;

  const postpaidSyncErrors =
    Number(
      postpaidSync?.errors ??
        0
    );

  const postpaidConnected =
    Boolean(dashboard) &&
    Boolean(
      postpaidSync?.enabled
    ) &&
    postpaidSyncErrors === 0;

  const postpaidDescription =
    !dashboard
      ? "目前無法讀取 Apps Script 報表 API。"
      : !postpaidSync
        ? "Apps Script 尚未回傳後結帳務同步狀態。"
        : postpaidSyncErrors > 0
          ? `本次同步有 ${postpaidSyncErrors} 筆後結帳務錯誤。`
          : `本次新增 ${Number(
              postpaidSync.charged ??
                0
            )} 筆、恢復 ${Number(
              postpaidSync.restored ??
                0
            )} 筆、撤回 ${Number(
              postpaidSync.reversed ??
                0
            )} 筆。`;

  /* =======================================================
     整體即時狀態
  ======================================================= */

  const overallConnected =
    isConnected &&
    firestoreConnected;

  const realtimeLabel =
    overallConnected
      ? "即時監控中"
      : dashboardLoading
        ? "正在連線"
        : "部分服務異常";

  /* =======================================================
     統計卡片
  ======================================================= */

  const stats = [
    {
      title: "會員總數",

      value: String(
        memberCount
      ),

      note: firestoreConnected
        ? "Firestore 會員資料即時統計"
        : "正在連接會員資料庫",

      live: true,

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

      value: String(
        todayPoints
      ),

      note: firestoreConnected
        ? "今天有效集點紀錄即時加總"
        : "正在連接集點紀錄",

      live: true,

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

      value: String(
        postpaidCustomerCount
      ),

      note: firestoreConnected
        ? `目前帳務餘額合計 ${formatMoney(
            postpaidTotalBalance
          )}`
        : "正在連接後結客戶資料",

      live: true,

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

      value: formatMoney(
        monthRewardAmount
      ),

      note: firestoreConnected
        ? "本月有效乘車金入帳即時加總"
        : "正在連接乘車金資料",

      live: true,

      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-6 w-6"
        >
          <rect
            x="2"
            y="5"
            width="20"
            height="14"
            rx="3"
          />

          <path d="M2 10h20" />
          <path d="M7 15h2" />
        </svg>
      ),
    },
  ];

  /* =======================================================
     手動同步
  ======================================================= */

  async function handleManualRefresh() {
    if (
      dashboardRefreshing
    ) {
      return;
    }

    setDashboardRefreshing(
      true
    );

    try {
      const data =
        await fetchDashboardData();

      setDashboard(data);

      setDashboardError("");

      setDashboardLastFetch(
        new Date()
      );
    } catch (error) {
      console.error(
        "手動同步失敗：",
        error
      );

      setDashboardError(
        error instanceof Error
          ? error.message
          : "同步失敗"
      );
    } finally {
      setDashboardRefreshing(
        false
      );
    }
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">

        {/* =================================================
            左側選單
        ================================================= */}

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

              <p className="text-lg font-bold">
                維尼車隊
              </p>

              <p className="text-xs text-slate-400">
                營運管理系統
              </p>

            </div>

          </div>

          <nav className="mt-10 space-y-2">

            {menuItems.map(
              (item) => {
                const className = `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                  item.active
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-950/20"
                    : item.disabled
                      ? "cursor-not-allowed text-slate-600"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`;

                if (
                  item.href &&
                  !item.disabled
                ) {
                  return (
                    <Link
                      key={
                        item.name
                      }
                      href={
                        item.href
                      }
                      className={
                        className
                      }
                    >
                      {
                        item.icon
                      }

                      <span>
                        {
                          item.name
                        }
                      </span>
                    </Link>
                  );
                }

                return (
                  <div
                    key={
                      item.name
                    }
                    className={
                      className
                    }
                  >
                    {
                      item.icon
                    }

                    <span>
                      {
                        item.name
                      }
                    </span>

                    {item.disabled && (
                      <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-500">
                        建置中
                      </span>
                    )}

                  </div>
                );
              }
            )}

          </nav>

          {/* ===============================================
              左下即時狀態
          =============================================== */}

          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">

            <div className="flex items-center gap-2">

              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  overallConnected
                    ? "bg-emerald-400"
                    : dashboardLoading
                      ? "bg-amber-400"
                      : "bg-red-400"
                }`}
              />

              <p className="text-sm font-semibold">

                {
                  realtimeLabel
                }

              </p>

            </div>

            <p className="mt-2 text-xs leading-5 text-slate-400">

              {overallConnected
                ? `正在監控「${sheetName}」與 Firestore。`
                : "正在確認報表與 Firebase 連線狀態。"}

            </p>

            <p className="mt-2 text-[11px] text-slate-500">

              報表：
              {
                formatTaipeiClock(
                  dashboardLastFetch
                )
              }

            </p>

            <p className="mt-1 text-[11px] text-slate-500">

              Firebase：
              {
                formatTaipeiClock(
                  firestoreLastUpdated
                )
              }

            </p>

          </div>

        </aside>

        {/* =================================================
            右側內容
        ================================================= */}

        <section className="min-w-0 flex-1">

          {/* ===============================================
              手機版上方
          =============================================== */}

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

                <p className="font-bold">
                  維尼車隊後台
                </p>

                <p className="text-xs text-slate-500">
                  營運管理系統
                </p>

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

            {/* ===============================================
                頁面標題
            =============================================== */}

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

                {/* LIVE */}

                <div className="mt-4 flex flex-wrap items-center gap-3">

                  <div
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                      overallConnected
                        ? "bg-emerald-50 text-emerald-700"
                        : dashboardLoading
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                    }`}
                  >

                    <span
                      className={`h-2 w-2 rounded-full ${
                        overallConnected
                          ? "bg-emerald-500"
                          : dashboardLoading
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                    />

                    {
                      realtimeLabel
                    }

                  </div>

                  <span className="text-xs text-slate-400">
                    Google 報表每 5 秒自動同步
                  </span>

                  <span className="text-xs text-slate-400">
                    Firestore 即時同步
                  </span>

                </div>

              </div>

              {/* =============================================
                  更新狀態
              ============================================= */}

              <div className="flex items-center gap-3">

                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">

                  <p className="text-xs text-slate-400">
                    資料更新狀態
                  </p>

                  <div className="mt-1 flex items-center gap-2">

                    <span
                      className={`h-2 w-2 rounded-full ${
                        overallConnected
                          ? "bg-emerald-500"
                          : dashboardLoading
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                    />

                    <span className="text-sm font-semibold text-slate-700">

                      {
                        realtimeLabel
                      }

                    </span>

                  </div>

                  <p className="mt-1 text-[11px] text-slate-400">

                    最後同步：
                    {
                      formatTaipeiClock(
                        dashboardLastFetch
                      )
                    }

                  </p>

                </div>

                <button
                  type="button"
                  onClick={
                    handleManualRefresh
                  }
                  disabled={
                    dashboardRefreshing
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="立即同步"
                  title="立即同步資料"
                >

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className={`h-5 w-5 ${
                      dashboardRefreshing
                        ? "animate-spin"
                        : ""
                    }`}
                  >
                    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
                    <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                  </svg>

                </button>

              </div>

            </header>

            {/* ===============================================
                錯誤提示
            =============================================== */}

            {(dashboardError ||
              firestoreError) && (

              <section className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4">

                <p className="text-sm font-bold text-red-700">
                  ⚠️ 部分即時資料目前無法同步
                </p>

                {dashboardError && (
                  <p className="mt-1 text-xs text-red-600">
                    Google 報表：
                    {
                      dashboardError
                    }
                  </p>
                )}

                {firestoreError && (
                  <p className="mt-1 text-xs text-red-600">
                    Firebase：
                    {
                      firestoreError
                    }
                  </p>
                )}

              </section>

            )}

            {/* ===============================================
                今日 / 本月單量
            =============================================== */}

            <section className="grid gap-5 md:grid-cols-2">

              {/* 今日有效單量 */}

              <article className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 to-blue-800 p-7 text-white shadow-xl shadow-blue-900/15">

                <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />

                <div className="absolute -bottom-16 right-14 h-36 w-36 rounded-full bg-white/5" />

                <div className="relative">

                  <div className="flex items-start justify-between">

                    <div>

                      <div className="flex items-center gap-2">

                        <p className="text-sm font-medium text-blue-100">
                          今日有效單量
                        </p>

                        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white">
                          5 秒同步
                        </span>

                      </div>

                      <div className="mt-5 flex items-end gap-2">

                        <span className="text-6xl font-bold tracking-tight">

                          {dashboardLoading &&
                          !dashboard
                            ? "—"
                            : todayCount}

                        </span>

                        <span className="pb-2 text-lg text-blue-100">
                          單
                        </span>

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

                  <div className="mt-8 flex items-center justify-between gap-3 border-t border-white/15 pt-4 text-sm text-blue-100">

                    <div className="flex items-center gap-2">

                      <span
                        className={`h-2 w-2 rounded-full ${
                          isConnected
                            ? "bg-emerald-300"
                            : "bg-red-300"
                        }`}
                      />

                      {isConnected
                        ? `已同步「${sheetName}」報表`
                        : "無法連接 Google 試算表"}

                    </div>

                    <span className="text-xs text-blue-200">
                      {
                        formatTaipeiClock(
                          dashboardLastFetch
                        )
                      }
                    </span>

                  </div>

                </div>

              </article>

              {/* 本月有效單量 */}

              <article className="relative overflow-hidden rounded-3xl bg-white p-7 shadow-sm ring-1 ring-slate-200/70">

                <div className="absolute right-0 top-0 h-36 w-36 rounded-bl-full bg-blue-50" />

                <div className="relative">

                  <div className="flex items-start justify-between">

                    <div>

                      <div className="flex items-center gap-2">

                        <p className="text-sm font-medium text-slate-500">
                          本月有效單量
                        </p>

                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                          5 秒同步
                        </span>

                      </div>

                      <div className="mt-5 flex items-end gap-2">

                        <span className="text-6xl font-bold tracking-tight text-slate-900">

                          {dashboardLoading &&
                          !dashboard
                            ? "—"
                            : monthCount}

                        </span>

                        <span className="pb-2 text-lg text-slate-400">
                          單
                        </span>

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
                        <rect
                          x="3"
                          y="4"
                          width="18"
                          height="17"
                          rx="2"
                        />

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

            {/* ===============================================
                Firestore 四張即時卡片
            =============================================== */}

            <section className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">

              {stats.map(
                (stat) => (

                  <article
                    key={
                      stat.title
                    }
                    className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
                  >

                    <div className="flex items-start justify-between">

                      <div>

                        <div className="flex items-center gap-2">

                          <p className="text-sm font-medium text-slate-500">
                            {
                              stat.title
                            }
                          </p>

                          {stat.live && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                              LIVE
                            </span>
                          )}

                        </div>

                        <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900">

                          {
                            stat.value
                          }

                        </p>

                      </div>

                      <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">

                        {
                          stat.icon
                        }

                      </div>

                    </div>

                    <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">

                      {
                        stat.note
                      }

                    </p>

                  </article>

                )
              )}

            </section>

            {/* ===============================================
                即時監控資訊
            =============================================== */}

            <section className="mt-5 grid gap-5 md:grid-cols-2">

              <article className="rounded-3xl border border-emerald-100 bg-emerald-50/60 p-6">

                <div className="flex items-start justify-between gap-4">

                  <div>

                    <p className="text-sm font-bold text-emerald-900">
                      Firestore 即時監控
                    </p>

                    <p className="mt-2 text-sm leading-6 text-emerald-700">
                      會員、點數、乘車金與後結帳務使用 Firebase onSnapshot 即時監聽。
                    </p>

                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      firestoreConnected
                        ? "bg-emerald-600 text-white"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {firestoreConnected
                      ? "LIVE"
                      : "連線中"}
                  </span>

                </div>

                <p className="mt-4 text-xs text-emerald-600">

                  最後更新：
                  {
                    formatTaipeiDateTime(
                      firestoreLastUpdated
                    )
                  }

                </p>

              </article>

              <article className="rounded-3xl border border-blue-100 bg-blue-50/60 p-6">

                <div className="flex items-start justify-between gap-4">

                  <div>

                    <p className="text-sm font-bold text-blue-900">
                      Google 報表快速同步
                    </p>

                    <p className="mt-2 text-sm leading-6 text-blue-700">
                      今日單量與本月單量每 5 秒重新向 Apps Script 取得最新資料。
                    </p>

                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      isConnected
                        ? "bg-blue-600 text-white"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {isConnected
                      ? "5 SEC"
                      : "異常"}
                  </span>

                </div>

                <p className="mt-4 text-xs text-blue-600">

                  最後同步：
                  {
                    formatTaipeiDateTime(
                      dashboardLastFetch
                    )
                  }

                </p>

              </article>

            </section>

            {/* ===============================================
                系統連接狀態
            =============================================== */}

            <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70 md:p-7">

              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">

                <div>

                  <div className="flex flex-wrap items-center gap-3">

                    <h2 className="text-lg font-bold text-slate-900">
                      系統連接狀態
                    </h2>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        overallConnected
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {overallConnected
                        ? "即時監控中"
                        : "正在確認"}
                    </span>

                  </div>

                  <p className="mt-2 text-sm text-slate-500">

                    {overallConnected
                      ? "Google 試算表採 5 秒快速同步，Firestore 資料採即時監聽。"
                      : "部分服務正在連線或發生異常，請查看下方狀態。"}

                  </p>

                </div>

                <div className="text-right">

                  <p className="text-xs text-slate-400">

                    Apps Script 回報：
                    {
                      lastUpdated
                    }

                  </p>

                  <p className="mt-1 text-xs text-slate-400">

                    本頁最後抓取：
                    {
                      formatTaipeiClock(
                        dashboardLastFetch
                      )
                    }

                  </p>

                </div>

              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">

                <StatusCard
                  title="Google 試算表"
                  description={
                    isConnected
                      ? `目前同步分頁：${sheetName}｜每 5 秒自動更新`
                      : dashboardError ||
                        "無法讀取每日派車報表"
                  }
                  status={
                    isConnected
                      ? "快速同步"
                      : "連接失敗"
                  }
                  connected={
                    isConnected
                  }
                />

                <StatusCard
                  title="會員集點系統"
                  description={
                    firestoreConnected
                      ? `目前共有 ${memberCount} 位會員，Firestore 資料即時更新。`
                      : "目前正在連接 Firestore 會員與集點資料。"
                  }
                  status={
                    firestoreConnected
                      ? "即時監控"
                      : "連線中"
                  }
                  connected={
                    firestoreConnected
                  }
                />

                <StatusCard
                  title="後結帳務系統"
                  description={
                    postpaidDescription
                  }
                  status={
                    postpaidConnected
                      ? "已啟用"
                      : postpaidSyncErrors >
                          0
                        ? "同步異常"
                        : "尚未確認"
                  }
                  connected={
                    postpaidConnected
                  }
                />

                <StatusCard
                  title="LINE 官方通知"
                  description={
                    lineDescription
                  }
                  status={
                    lineConnected
                      ? "已連接"
                      : lineErrors >
                          0
                        ? "通知異常"
                        : "尚未確認"
                  }
                  connected={
                    lineConnected
                  }
                />

              </div>

            </section>

          </div>

        </section>

      </div>

    </main>
  );
}

/* =========================================================
   系統狀態卡
========================================================= */

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
            connected
              ? "text-emerald-600"
              : "text-slate-500"
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

      <h3 className="mt-4 font-semibold text-slate-900">
        {title}
      </h3>

      <p className="mt-1 text-sm leading-6 text-slate-500">
        {description}
      </p>

    </article>
  );
}