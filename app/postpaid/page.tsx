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


type PendingLineUser = {
  id: string;
  bindingStatus: string;
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
  if (!value) return "—";

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value.toDate());
}

export default function PostpaidPage() {
  const [customers, setCustomers] = useState<PostpaidCustomer[]>([]);
  const [pendingLineUsers, setPendingLineUsers] = useState<PendingLineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");

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
            balance: Number(data.balance ?? 0),
            openingBalance: Number(data.openingBalance ?? 0),
            totalRides: Number(data.totalRides ?? 0),
            totalPostpaidAmount: Number(data.totalPostpaidAmount ?? 0),
            lineUserId: String(data.lineUserId ?? ""),
            status: String(data.status ?? "active"),
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt
                : undefined,
          } satisfies PostpaidCustomer;
        });

        rows.sort((a, b) =>
          a.customerCode.localeCompare(b.customerCode, "zh-TW")
        );

        setCustomers(rows);
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("讀取後結客戶失敗，請檢查 Firestore 權限。");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "pendingLineUsers"),
      (snapshot) => {
        const rows = snapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            bindingStatus: String(data.bindingStatus ?? "pending"),
          } satisfies PendingLineUser;
        });

        setPendingLineUsers(rows);
      },
      (snapshotError) => {
        console.error("讀取 LINE 待綁定名單失敗：", snapshotError);
      }
    );

    return unsubscribe;
  }, []);

  const filteredCustomers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

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
        value.toLowerCase().includes(normalizedKeyword)
      );
    });
  }, [customers, keyword, statusFilter]);

  const activeCustomers = customers.filter(
    (customer) => customer.status === "active"
  );

  const totalBalance = activeCustomers.reduce(
    (sum, customer) => sum + customer.balance,
    0
  );

  const totalDebt = activeCustomers.reduce(
    (sum, customer) =>
      sum + Math.abs(Math.min(0, customer.balance)),
    0
  );

  const totalDeposit = activeCustomers.reduce(
    (sum, customer) =>
      sum + Math.max(0, customer.balance),
    0
  );

  const pendingLineCount = pendingLineUsers.filter(
    (user) => user.bindingStatus !== "bound"
  ).length;

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col bg-[#0f1b2d] px-5 py-6 text-white lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-xl shadow-lg">
              🚕
            </div>

            <div>
              <p className="text-lg font-bold">維尼車隊</p>
              <p className="text-xs text-slate-400">營運管理系統</p>
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
                <span>{item.name}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-8">
            <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-sm font-semibold text-blue-600">
                  後結帳務系統
                </p>
                <h1 className="mt-1 text-3xl font-bold">後結帳務</h1>
                <p className="mt-2 text-sm text-slate-500">
                  管理後結客戶、目前餘額與歷史帳務。
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/postpaid/bind-line"
                  className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
                >
                  🔗 LINE 待綁定
                  {pendingLineCount > 0 && (
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

            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["後結客戶", `${activeCustomers.length} 位`],
                ["帳務餘額合計", formatMoney(totalBalance)],
                ["欠款總額", formatMoney(totalDebt)],
                ["儲值餘額", formatMoney(totalDeposit)],
              ].map(([title, value]) => (
                <article
                  key={title}
                  className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
                >
                  <p className="text-sm text-slate-500">{title}</p>
                  <p className="mt-4 text-3xl font-bold">{value}</p>
                </article>
              ))}
            </section>

            {pendingLineCount > 0 && (
              <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold text-emerald-900">
                      有 {pendingLineCount} 位 LINE 使用者等待綁定
                    </p>
                    <p className="mt-1 text-sm text-emerald-700">
                      客人傳訊息給官方帳號後，會出現在待綁定名單。
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

            <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-bold">後結客戶名單</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    可搜尋客戶代號、姓名或手機。
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value)
                    }
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="all">全部狀態</option>
                    <option value="active">啟用中</option>
                    <option value="disabled">已停用</option>
                  </select>

                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜尋後結客戶..."
                    className="min-w-64 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {error && (
                <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="mt-6 overflow-x-auto">
                <table className="min-w-[950px] w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-400">
                      <th className="px-3 py-4">客戶</th>
                      <th className="px-3 py-4">手機</th>
                      <th className="px-3 py-4">目前餘額</th>
                      <th className="px-3 py-4">累積後結</th>
                      <th className="px-3 py-4">搭乘次數</th>
                      <th className="px-3 py-4">LINE</th>
                      <th className="px-3 py-4">狀態</th>
                      <th className="px-3 py-4">最後更新</th>
                      <th className="px-3 py-4">操作</th>
                    </tr>
                  </thead>

                  <tbody>
                    {loading ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-3 py-12 text-center text-sm text-slate-500"
                        >
                          讀取中...
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
                      filteredCustomers.map((customer) => (
                        <tr
                          key={customer.id}
                          className="border-b border-slate-100 text-sm"
                        >
                          <td className="px-3 py-5">
                            <p className="font-bold">{customer.name || "未填姓名"}</p>
                            <p className="mt-1 text-xs font-semibold text-blue-600">
                              {customer.customerCode}
                            </p>
                          </td>
                          <td className="px-3 py-5 text-slate-600">
                            {customer.phone || "—"}
                          </td>
                          <td
                            className={`px-3 py-5 font-bold ${
                              customer.balance < 0
                                ? "text-red-600"
                                : customer.balance > 0
                                  ? "text-emerald-600"
                                  : "text-slate-800"
                            }`}
                          >
                            {formatMoney(customer.balance)}
                          </td>
                          <td className="px-3 py-5">
                            {formatMoney(customer.totalPostpaidAmount)}
                          </td>
                          <td className="px-3 py-5">
                            {customer.totalRides} 次
                          </td>
                          <td className="px-3 py-5">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                customer.lineUserId
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {customer.lineUserId ? "已綁定" : "尚未綁定"}
                            </span>
                          </td>
                          <td className="px-3 py-5">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                customer.status === "active"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {customer.status === "active" ? "啟用中" : "已停用"}
                            </span>
                          </td>
                          <td className="px-3 py-5 text-xs text-slate-500">
                            {formatDate(customer.updatedAt)}
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
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}