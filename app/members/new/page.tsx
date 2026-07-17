"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

function formatMemberCode(number: number) {
  return `V${String(number).padStart(4, "0")}`;
}

export default function NewMemberPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedName = name.trim();
    const normalizedPhone = phone.replace(/\s+/g, "").trim();
    const normalizedNote = note.trim();

    if (!normalizedName) {
      setErrorMessage("請輸入會員姓名");
      return;
    }

    if (!/^09\d{8}$/.test(normalizedPhone)) {
      setErrorMessage("手機號碼格式不正確，請輸入 09 開頭的 10 碼號碼");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");

    try {
      // 避免同一支手機重複註冊
      const duplicateQuery = query(
        collection(db, "members"),
        where("phone", "==", normalizedPhone)
      );

      const duplicateSnapshot = await getDocs(duplicateQuery);

      if (!duplicateSnapshot.empty) {
        throw new Error("這支手機號碼已經建立過會員");
      }

      const memberCode = await runTransaction(db, async (transaction) => {
        const counterRef = doc(db, "systemCounters", "members");
        const counterSnapshot = await transaction.get(counterRef);

        const nextNumber = counterSnapshot.exists()
          ? Number(counterSnapshot.data().nextNumber ?? 1)
          : 1;

        const generatedMemberCode = formatMemberCode(nextNumber);
        const memberRef = doc(db, "members", generatedMemberCode);

        transaction.set(memberRef, {
          memberCode: generatedMemberCode,
          name: normalizedName,
          phone: normalizedPhone,
          note: normalizedNote,

          lineUserId: "",
          lineDisplayName: "",

          points: 0,
          rideCredit: 0,
          totalRides: 0,

          status: "active",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(
          counterRef,
          {
            nextNumber: nextNumber + 1,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        return generatedMemberCode;
      });

      router.push(`/member-card/${memberCode}`);
    } catch (error) {
      console.error("新增會員失敗：", error);

      setErrorMessage(
        error instanceof Error ? error.message : "新增會員失敗，請稍後再試"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 md:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-600">會員管理</p>

            <h1 className="mt-1 text-3xl font-bold">新增會員</h1>

            <p className="mt-2 text-sm text-slate-500">
              建立會員後，系統會自動產生專屬會員編號。
            </p>
          </div>

          <Link
            href="/members"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            返回會員列表
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70 md:p-8"
        >
          <div className="rounded-2xl bg-blue-50 p-5">
            <p className="text-sm font-semibold text-blue-700">
              會員集點活動
            </p>

            <p className="mt-2 text-sm leading-6 text-blue-700/80">
              成功派車可獲得 1 點，集滿 10 點自動兌換 NT$60
              乘車金。
            </p>
          </div>

          <div className="mt-7 space-y-6">
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                會員姓名
              </label>

              <input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：王小姐"
                autoComplete="name"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                手機號碼
              </label>

              <input
                id="phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="例如：0912345678"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={10}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />

              <p className="mt-2 text-xs text-slate-400">
                未來會以手機號碼比對報表會員資料。
              </p>
            </div>

            <div>
              <label
                htmlFor="note"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                備註
              </label>

              <textarea
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="可填寫常用上下車點、特殊需求或其他備註"
                rows={4}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3.5 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link
              href="/members"
              className="rounded-2xl border border-slate-200 px-6 py-3.5 text-center text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              取消
            </Link>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "建立會員中…" : "建立會員"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}