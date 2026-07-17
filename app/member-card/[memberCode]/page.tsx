"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
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

const POINTS_REQUIRED = 10;
const REWARD_AMOUNT = 60;

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function MemberCardPage() {
  const params = useParams<{ memberCode: string }>();
  const memberCode = decodeURIComponent(params.memberCode ?? "");

  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadMember = useCallback(async () => {
    if (!memberCode) {
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const memberSnapshot = await getDoc(doc(db, "members", memberCode));

      if (!memberSnapshot.exists()) {
        setMember(null);
        setErrorMessage("找不到這位會員");
        return;
      }

      const data = memberSnapshot.data();

      setMember({
        memberCode: String(data.memberCode ?? memberSnapshot.id),
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
      });
    } catch (error) {
      console.error("讀取會員失敗：", error);
      setErrorMessage("讀取會員資料失敗");
    } finally {
      setLoading(false);
    }
  }, [memberCode]);

  useEffect(() => {
    void loadMember();
  }, [loadMember]);

  async function addOnePoint() {
    if (!member || updating) {
      return;
    }

    setUpdating(true);
    setMessage("");
    setErrorMessage("");

    try {
      const memberRef = doc(db, "members", member.memberCode);

      const pointTransactionRef = doc(collection(db, "pointTransactions"));
      const rideCreditTransactionRef = doc(
        collection(db, "rideCreditTransactions")
      );

      const result = await runTransaction(db, async (transaction) => {
        const memberSnapshot = await transaction.get(memberRef);

        if (!memberSnapshot.exists()) {
          throw new Error("會員資料不存在");
        }

        const currentData = memberSnapshot.data();

        const currentPoints = Number(currentData.points ?? 0);
        const currentRideCredit = Number(currentData.rideCredit ?? 0);
        const currentTotalRides = Number(currentData.totalRides ?? 0);

        const pointsBeforeReward = currentPoints + 1;
        const rewardCount = Math.floor(
          pointsBeforeReward / POINTS_REQUIRED
        );

        const remainingPoints =
          pointsBeforeReward % POINTS_REQUIRED;

        const rewardAmount = rewardCount * REWARD_AMOUNT;
        const newRideCredit = currentRideCredit + rewardAmount;

        transaction.update(memberRef, {
          points: remainingPoints,
          rideCredit: newRideCredit,
          totalRides: currentTotalRides + 1,
          updatedAt: serverTimestamp(),
        });

        transaction.set(pointTransactionRef, {
          memberCode: member.memberCode,
          memberName: member.name,
          points: 1,
          type: "earn",
          reason: "手動測試成功派車",
          source: "admin_manual_test",
          createdAt: serverTimestamp(),
        });

        if (rewardAmount > 0) {
          transaction.set(rideCreditTransactionRef, {
            memberCode: member.memberCode,
            memberName: member.name,
            amount: rewardAmount,
            type: "reward",
            reason: `集滿 ${POINTS_REQUIRED} 點自動兌換`,
            createdAt: serverTimestamp(),
          });
        }

        return {
          remainingPoints,
          rewardAmount,
          newRideCredit,
        };
      });

      if (result.rewardAmount > 0) {
        setMessage(
          `集滿 10 點！已自動兌換 ${formatMoney(
            result.rewardAmount
          )} 乘車金。`
        );
      } else {
        setMessage(`集點成功，目前累積 ${result.remainingPoints}／10 點。`);
      }

      await loadMember();
    } catch (error) {
      console.error("增加點數失敗：", error);

      setErrorMessage(
        error instanceof Error ? error.message : "增加點數失敗"
      );
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />

          <p className="mt-4 text-sm text-slate-500">讀取會員集點卡中…</p>
        </div>
      </main>
    );
  }

  if (!member) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <p className="text-xl font-bold">找不到會員</p>

          <p className="mt-2 text-sm text-slate-500">
            {errorMessage || "這個會員編號不存在。"}
          </p>

          <Link
            href="/members"
            className="mt-6 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
          >
            返回會員列表
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#edf4ff] via-[#f8fbff] to-[#eef2f7] px-4 py-7 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Link
            href="/members"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm"
          >
            ← 會員列表
          </Link>

          <span
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              member.status === "active"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {member.status === "active" ? "會員啟用中" : "會員已停用"}
          </span>
        </div>

        <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-blue-600 to-blue-900 p-7 text-white shadow-2xl shadow-blue-900/20 md:p-9">
          <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-white/10" />
          <div className="absolute -bottom-20 left-20 h-48 w-48 rounded-full bg-white/5" />

          <div className="relative">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
              <div>
                <p className="text-sm font-medium text-blue-100">
                  維尼車隊會員
                </p>

                <h1 className="mt-2 text-3xl font-bold">{member.name}</h1>

                <p className="mt-2 font-mono text-sm tracking-widest text-blue-100">
                  {member.memberCode}
                </p>
              </div>

              <div className="rounded-2xl bg-white/15 px-5 py-4 backdrop-blur">
                <p className="text-xs text-blue-100">可用乘車金</p>

                <p className="mt-1 text-2xl font-bold">
                  {formatMoney(member.rideCredit)}
                </p>
              </div>
            </div>

            <div className="mt-8 border-t border-white/15 pt-6">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm text-blue-100">目前集點</p>

                  <p className="mt-1 text-5xl font-bold">
                    {member.points}
                    <span className="ml-2 text-lg font-medium text-blue-100">
                      ／10 點
                    </span>
                  </p>
                </div>

                <p className="text-sm text-blue-100">
                  累積搭乘 {member.totalRides} 次
                </p>
              </div>

              <div className="mt-6 grid grid-cols-5 gap-3 sm:grid-cols-10">
                {Array.from({ length: POINTS_REQUIRED }).map((_, index) => {
                  const active = index < member.points;

                  return (
                    <div
                      key={index}
                      className={`flex aspect-square items-center justify-center rounded-full border text-sm font-bold ${
                        active
                          ? "border-amber-300 bg-amber-300 text-amber-900 shadow-lg shadow-amber-900/20"
                          : "border-white/25 bg-white/10 text-white/50"
                      }`}
                    >
                      {active ? "★" : index + 1}
                    </div>
                  );
                })}
              </div>

              <p className="mt-5 text-sm text-blue-100">
                再累積 {POINTS_REQUIRED - member.points} 點，即可自動獲得
                NT$60 乘車金。
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-3">
          <InfoCard title="手機號碼" value={member.phone} />

          <InfoCard
            title="LINE 綁定"
            value={member.lineUserId ? "已完成綁定" : "尚未綁定"}
          />

          <InfoCard
            title="會員狀態"
            value={member.status === "active" ? "正常使用" : "已停用"}
          />
        </section>

        {member.note && (
          <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
            <p className="text-sm font-semibold text-slate-500">會員備註</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {member.note}
            </p>
          </section>
        )}

        {message && (
          <div className="mt-5 rounded-2xl bg-emerald-100 px-5 py-4 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="mt-5 rounded-2xl bg-red-100 px-5 py-4 text-sm font-semibold text-red-700">
            {errorMessage}
          </div>
        )}

        <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-bold">集點測試</h2>

              <p className="mt-1 text-sm text-slate-500">
                目前先用手動按鈕測試，後續會改為報表自動集點。
              </p>
            </div>

            <button
              type="button"
              onClick={() => void addOnePoint()}
              disabled={updating || member.status !== "active"}
              className="rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updating ? "處理中…" : "成功派車＋1 點"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function InfoCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-slate-400">{title}</p>
      <p className="mt-2 font-semibold text-slate-800">{value}</p>
    </article>
  );
}