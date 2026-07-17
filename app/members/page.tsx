"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type Member = {
  memberCode: string;
  name: string;
  phone: string;
  note: string;
  points: number;
  rideCredit: number;
  totalRides: number;
  status: string;
  lineUserId: string;
  createdAt: Timestamp | null;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: Timestamp | null) {
  if (!value) {
    return "剛剛建立";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value.toDate());
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadMembers() {
    setLoading(true);
    setErrorMessage("");

    try {
      const membersQuery = query(
        collection(db, "members"),
        orderBy("createdAt", "desc")
      );

      const snapshot = await getDocs(membersQuery);

      const result: Member[] = snapshot.docs.map((memberDocument) => {
        const data = memberDocument.data();

        return {
          memberCode: String(data.memberCode ?? memberDocument.id),
          name: String(data.name ?? ""),
          phone: String(data.phone ?? ""),
          note: String(data.note ?? ""),
          points: Number(data.points ?? 0),
          rideCredit: Number(data.rideCredit ?? 0),
          totalRides: Number(data.totalRides ?? 0),
          status: String(data.status ?? "active"),
          lineUserId: String(data.lineUserId ?? ""),
          createdAt:
            data.createdAt instanceof Timestamp ? data.createdAt : null,
        };
      });

      setMembers(result);
    } catch (error) {
      console.error("讀取會員失敗：", error);
      setErrorMessage("無法讀取會員資料，請確認 Firestore 權限設定。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, []);

  const filteredMembers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();

    if (!keyword) {
      return members;
    }

    return members.filter((member) => {
      return (
        member.memberCode.toLowerCase().includes(keyword) ||
        member.name.toLowerCase().includes(keyword) ||
        member.phone.includes(keyword)
      );
    });
  }, [members, searchText]);

  const totalPoints = members.reduce(
    (total, member) => total + member.points,
    0
  );

  const totalRideCredit = members.reduce(
    (total, member) => total + member.rideCredit,
    0
  );

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 bg-[#0f1b2d] px-5 py-6 text-white lg:block">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500">
              🚕
            </div>

            <div>
              <p className="text-lg font-bold">維尼車隊</p>
              <p className="text-xs text-slate-400">營運管理系統</p>
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
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              ◫　調度與財務
            </Link>

            <Link
              href="/members"
              className="block rounded-xl bg-blue-500 px-4 py-3 text-sm font-medium text-white shadow-lg"
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
              href="/credits"
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              ▭　乘車金管理
            </Link>
          </nav>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-5 py-7 md:px-8">
            <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-sm font-semibold text-blue-600">會員中心</p>

                <h1 className="mt-1 text-3xl font-bold">會員管理</h1>

                <p className="mt-2 text-sm text-slate-500">
                  管理會員基本資料、集點與乘車金。
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void loadMembers()}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                >
                  重新整理
                </button>

                <Link
                  href="/members/new"
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  ＋ 新增會員
                </Link>
              </div>
            </header>

            <section className="grid gap-4 md:grid-cols-3">
              <SummaryCard
                title="會員總數"
                value={`${members.length} 人`}
                note="目前已建立的會員"
              />

              <SummaryCard
                title="會員總點數"
                value={`${totalPoints} 點`}
                note="尚未轉換的有效點數"
              />

              <SummaryCard
                title="可用乘車金"
                value={formatMoney(totalRideCredit)}
                note="所有會員乘車金餘額"
              />
            </section>

            <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 md:p-6">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="text-lg font-bold">會員名單</h2>

                  <p className="mt-1 text-sm text-slate-500">
                    可搜尋會員編號、姓名或手機號碼。
                  </p>
                </div>

                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜尋會員…"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 md:max-w-sm"
                />
              </div>

              {errorMessage && (
                <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {errorMessage}
                </div>
              )}

              <div className="mt-6 overflow-x-auto">
                {loading ? (
                  <div className="py-16 text-center text-sm text-slate-400">
                    正在讀取會員資料…
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 py-16 text-center">
                    <p className="font-semibold text-slate-600">
                      目前沒有符合的會員
                    </p>

                    <p className="mt-2 text-sm text-slate-400">
                      建立第一位會員後，資料會顯示在這裡。
                    </p>

                    <Link
                      href="/members/new"
                      className="mt-5 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
                    >
                      新增會員
                    </Link>
                  </div>
                ) : (
                  <table className="w-full min-w-[900px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-400">
                        <th className="px-4 py-3 font-medium">會員</th>
                        <th className="px-4 py-3 font-medium">手機</th>
                        <th className="px-4 py-3 font-medium">點數</th>
                        <th className="px-4 py-3 font-medium">乘車金</th>
                        <th className="px-4 py-3 font-medium">搭乘次數</th>
                        <th className="px-4 py-3 font-medium">LINE 綁定</th>
                        <th className="px-4 py-3 font-medium">建立日期</th>
                        <th className="px-4 py-3 font-medium">操作</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredMembers.map((member) => (
                        <tr
                          key={member.memberCode}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="px-4 py-4">
                            <p className="font-semibold text-slate-900">
                              {member.name}
                            </p>

                            <p className="mt-1 text-xs font-medium text-blue-600">
                              {member.memberCode}
                            </p>
                          </td>

                          <td className="px-4 py-4 text-sm text-slate-600">
                            {member.phone}
                          </td>

                          <td className="px-4 py-4">
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-700">
                              {member.points} 點
                            </span>
                          </td>

                          <td className="px-4 py-4 font-semibold">
                            {formatMoney(member.rideCredit)}
                          </td>

                          <td className="px-4 py-4 text-sm">
                            {member.totalRides} 次
                          </td>

                          <td className="px-4 py-4">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                member.lineUserId
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {member.lineUserId ? "已綁定" : "尚未綁定"}
                            </span>
                          </td>

                          <td className="px-4 py-4 text-sm text-slate-500">
                            {formatDate(member.createdAt)}
                          </td>

                          <td className="px-4 py-4">
                            <Link
                              href={`/member-card/${member.memberCode}`}
                              className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-100"
                            >
                              查看集點卡
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
      <p className="text-sm font-medium text-slate-500">{title}</p>

      <p className="mt-4 text-3xl font-bold">{value}</p>

      <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
        {note}
      </p>
    </article>
  );
}