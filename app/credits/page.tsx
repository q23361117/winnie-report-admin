"use client";

import Link from "next/link";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";

type Member = {
  memberCode: string;
  name: string;
  phone: string;
  rideCredit: number;
  pendingCreditRecovery: number;
  needsManualReview: boolean;
  status: string;
};

type CreditRecord = {
  id: string;
  transactionId: string;
  memberCode: string;
  memberName: string;
  amount: number;
  type: string;
  status: string;
  reason: string;
  source: string;
  createdAt: Timestamp | null;
};

type FilterType = "all" | "deposit" | "use" | "reversal";

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: Timestamp | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value.toDate());
}

function getRecordTypeLabel(record: CreditRecord) {
  if (record.type === "reward") {
    return "集點兌換";
  }

  if (record.type === "manual_add") {
    return "後台加值";
  }

  if (record.type === "use") {
    return "使用乘車金";
  }

  if (record.type === "reversal") {
    return "撤回乘車金";
  }

  if (record.type === "restore") {
    return "恢復乘車金";
  }

  return record.type || "其他";
}

function getSourceLabel(source: string) {
  if (source === "google_sheets_report") {
    return "報表自動兌換";
  }

  if (source === "admin_dashboard") {
    return "後台操作";
  }

  if (source === "google_sheets_report_reconcile") {
    return "報表撤回校正";
  }

  return source || "其他來源";
}

export default function CreditsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [records, setRecords] = useState<CreditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [operatingCode, setOperatingCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] =
    useState<FilterType>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const [membersSnapshot, recordsSnapshot] =
        await Promise.all([
          getDocs(collection(db, "members")),
          getDocs(
            collection(
              db,
              "rideCreditTransactions"
            )
          ),
        ]);

      const memberResult: Member[] =
        membersSnapshot.docs.map((memberDocument) => {
          const data = memberDocument.data();

          return {
            memberCode: String(
              data.memberCode ?? memberDocument.id
            ),
            name: String(data.name ?? ""),
            phone: String(data.phone ?? ""),
            rideCredit: Number(
              data.rideCredit ?? 0
            ),
            pendingCreditRecovery: Number(
              data.pendingCreditRecovery ?? 0
            ),
            needsManualReview: Boolean(
              data.needsManualReview ?? false
            ),
            status: String(
              data.status ?? "active"
            ),
          };
        });

      memberResult.sort((a, b) =>
        a.memberCode.localeCompare(
          b.memberCode,
          "zh-TW",
          { numeric: true }
        )
      );

      const recordResult: CreditRecord[] =
        recordsSnapshot.docs.map(
          (recordDocument) => {
            const data = recordDocument.data();

            return {
              id: recordDocument.id,
              transactionId: String(
                data.transactionId ??
                  recordDocument.id
              ),
              memberCode: String(
                data.memberCode ?? ""
              ),
              memberName: String(
                data.memberName ?? ""
              ),
              amount: Number(data.amount ?? 0),
              type: String(data.type ?? ""),
              status: String(
                data.status ?? "active"
              ),
              reason: String(
                data.reason ?? ""
              ),
              source: String(
                data.source ?? ""
              ),
              createdAt:
                data.createdAt instanceof Timestamp
                  ? data.createdAt
                  : null,
            };
          }
        );

      recordResult.sort((a, b) => {
        const aTime =
          a.createdAt?.toMillis() ?? 0;
        const bTime =
          b.createdAt?.toMillis() ?? 0;

        return bTime - aTime;
      });

      setMembers(memberResult);
      setRecords(recordResult);
    } catch (error) {
      console.error("讀取乘車金資料失敗：", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "無法讀取乘車金資料"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const adjustCredit = useCallback(
    async (
      member: Member,
      mode: "add" | "use"
    ) => {
      const actionName =
        mode === "add" ? "增加" : "扣除";

      const amountInput = window.prompt(
        `請輸入要${actionName}的乘車金金額：`,
        mode === "add" ? "60" : ""
      );

      if (amountInput === null) {
        return;
      }

      const amount = Math.floor(
        Number(amountInput)
      );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        window.alert(
          "請輸入大於 0 的整數金額。"
        );
        return;
      }

      const reasonInput = window.prompt(
        "請輸入操作原因：",
        mode === "add"
          ? "後台手動增加乘車金"
          : "會員搭乘使用乘車金"
      );

      if (reasonInput === null) {
        return;
      }

      const reason =
        reasonInput.trim() ||
        (mode === "add"
          ? "後台手動增加乘車金"
          : "會員搭乘使用乘車金");

      const confirmed = window.confirm(
        `確定要為 ${member.memberCode}｜${member.name || "未填姓名"} ${actionName} ${formatMoney(amount)} 嗎？\n\n目前餘額：${formatMoney(member.rideCredit)}\n原因：${reason}`
      );

      if (!confirmed) {
        return;
      }

      setOperatingCode(member.memberCode);
      setErrorMessage("");

      try {
        const memberRef = doc(
          db,
          "members",
          member.memberCode
        );

        const recordRef = doc(
          collection(
            db,
            "rideCreditTransactions"
          )
        );

        await runTransaction(
          db,
          async (transaction) => {
            const memberSnapshot =
              await transaction.get(memberRef);

            if (!memberSnapshot.exists()) {
              throw new Error(
                `找不到會員 ${member.memberCode}`
              );
            }

            const memberData =
              memberSnapshot.data();

            const currentBalance = Math.max(
              0,
              Number(
                memberData.rideCredit ?? 0
              )
            );

            if (
              mode === "use" &&
              currentBalance < amount
            ) {
              throw new Error(
                `乘車金不足，目前只有 ${formatMoney(currentBalance)}`
              );
            }

            const signedAmount =
              mode === "add"
                ? amount
                : -amount;

            const newBalance =
              currentBalance +
              signedAmount;

            transaction.update(memberRef, {
              rideCredit: newBalance,
              updatedAt: serverTimestamp(),
            });

            transaction.set(recordRef, {
              transactionId: recordRef.id,
              memberCode:
                member.memberCode,
              memberName:
                member.name || "",
              amount: signedAmount,
              type:
                mode === "add"
                  ? "manual_add"
                  : "use",
              status: "active",
              reason,
              source: "admin_dashboard",
              balanceBefore:
                currentBalance,
              balanceAfter: newBalance,
              createdAt: serverTimestamp(),
            });
          }
        );

        window.alert(
          `乘車金已成功${actionName}。`
        );

        await loadData();
      } catch (error) {
        console.error(
          "調整乘車金失敗：",
          error
        );

        const message =
          error instanceof Error
            ? error.message
            : "調整乘車金失敗";

        setErrorMessage(message);
        window.alert(message);
      } finally {
        setOperatingCode("");
      }
    },
    [loadData]
  );

  const filteredMembers = useMemo(() => {
    const keyword = searchText
      .trim()
      .toLowerCase();

    if (!keyword) {
      return members;
    }

    return members.filter((member) =>
      [
        member.memberCode,
        member.name,
        member.phone,
      ].some((value) =>
        value
          .toLowerCase()
          .includes(keyword)
      )
    );
  }, [members, searchText]);

  const filteredRecords = useMemo(() => {
    const keyword = searchText
      .trim()
      .toLowerCase();

    return records.filter((record) => {
      if (filterType === "deposit") {
        if (record.amount <= 0) {
          return false;
        }
      }

      if (filterType === "use") {
        if (record.type !== "use") {
          return false;
        }
      }

      if (filterType === "reversal") {
        if (record.type !== "reversal") {
          return false;
        }
      }

      if (!keyword) {
        return true;
      }

      return [
        record.memberCode,
        record.memberName,
        record.reason,
        record.source,
      ].some((value) =>
        value
          .toLowerCase()
          .includes(keyword)
      );
    });
  }, [records, searchText, filterType]);

  const totalBalance = members.reduce(
    (total, member) =>
      total + member.rideCredit,
    0
  );

  const memberWithBalanceCount =
    members.filter(
      (member) => member.rideCredit > 0
    ).length;

  const totalPendingRecovery =
    members.reduce(
      (total, member) =>
        total +
        member.pendingCreditRecovery,
      0
    );

  const totalDeposits =
    records.reduce(
      (total, record) =>
        total +
        Math.max(record.amount, 0),
      0
    );

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">
        <Sidebar />

        <section className="min-w-0 flex-1">
          <MobileHeader />

          <div className="mx-auto max-w-7xl px-5 py-7 md:px-8">
            <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-sm font-semibold text-blue-600">
                  會員乘車金系統
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                  乘車金管理
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  查看會員餘額、入帳、使用與撤回紀錄。
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadData()}
                disabled={loading}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? "整理中…"
                  : "重新整理"}
              </button>
            </header>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                title="可用乘車金總額"
                value={formatMoney(totalBalance)}
                note="所有會員目前可用餘額"
              />

              <SummaryCard
                title="有餘額會員"
                value={`${memberWithBalanceCount} 人`}
                note="乘車金大於 0 的會員"
              />

              <SummaryCard
                title="累計入帳"
                value={formatMoney(totalDeposits)}
                note="所有正數乘車金紀錄"
              />

              <SummaryCard
                title="待人工回收"
                value={formatMoney(
                  totalPendingRecovery
                )}
                note="撤回時餘額不足的金額"
                danger={
                  totalPendingRecovery > 0
                }
              />
            </section>

            {errorMessage && (
              <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {errorMessage}
              </div>
            )}

            <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 md:p-6">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="text-xl font-bold">
                    會員乘車金餘額
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    可從後台增加或扣除乘車金。
                  </p>
                </div>

                <input
                  value={searchText}
                  onChange={(event) =>
                    setSearchText(
                      event.target.value
                    )
                  }
                  placeholder="搜尋會員…"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 md:max-w-sm"
                />
              </div>

              <div className="mt-6 overflow-x-auto">
                {loading ? (
                  <LoadingState text="正在讀取會員乘車金…" />
                ) : filteredMembers.length ===
                  0 ? (
                  <EmptyState text="目前沒有符合的會員" />
                ) : (
                  <table className="w-full min-w-[950px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-400">
                        <th className="px-4 py-3 font-medium">
                          會員
                        </th>
                        <th className="px-4 py-3 font-medium">
                          手機
                        </th>
                        <th className="px-4 py-3 font-medium">
                          目前餘額
                        </th>
                        <th className="px-4 py-3 font-medium">
                          待人工回收
                        </th>
                        <th className="px-4 py-3 font-medium">
                          狀態
                        </th>
                        <th className="px-4 py-3 font-medium">
                          操作
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredMembers.map(
                        (member) => {
                          const operating =
                            operatingCode ===
                            member.memberCode;

                          return (
                            <tr
                              key={
                                member.memberCode
                              }
                              className="border-b border-slate-100 last:border-0"
                            >
                              <td className="px-4 py-4">
                                <p className="font-semibold">
                                  {member.name ||
                                    "未填姓名"}
                                </p>
                                <Link
                                  href={`/member-card/${member.memberCode}`}
                                  className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline"
                                >
                                  {
                                    member.memberCode
                                  }
                                </Link>
                              </td>

                              <td className="px-4 py-4 text-sm text-slate-600">
                                {member.phone ||
                                  "—"}
                              </td>

                              <td className="px-4 py-4 text-lg font-bold">
                                {formatMoney(
                                  member.rideCredit
                                )}
                              </td>

                              <td className="px-4 py-4">
                                {member.pendingCreditRecovery >
                                0 ? (
                                  <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
                                    {formatMoney(
                                      member.pendingCreditRecovery
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-sm text-slate-400">
                                    —
                                  </span>
                                )}
                              </td>

                              <td className="px-4 py-4">
                                {member.needsManualReview ? (
                                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                                    需人工處理
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                    正常
                                  </span>
                                )}
                              </td>

                              <td className="px-4 py-4">
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void adjustCredit(
                                        member,
                                        "add"
                                      )
                                    }
                                    disabled={
                                      operating
                                    }
                                    className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                                  >
                                    增加
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      void adjustCredit(
                                        member,
                                        "use"
                                      )
                                    }
                                    disabled={
                                      operating
                                    }
                                    className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                                  >
                                    使用
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 md:p-6">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="text-xl font-bold">
                    乘車金明細
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    查看入帳、使用、撤回與校正紀錄。
                  </p>
                </div>

                <select
                  value={filterType}
                  onChange={(event) =>
                    setFilterType(
                      event.target
                        .value as FilterType
                    )
                  }
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                >
                  <option value="all">
                    全部類型
                  </option>
                  <option value="deposit">
                    只看入帳
                  </option>
                  <option value="use">
                    只看使用
                  </option>
                  <option value="reversal">
                    只看撤回
                  </option>
                </select>
              </div>

              <div className="mt-6 overflow-x-auto">
                {loading ? (
                  <LoadingState text="正在讀取乘車金紀錄…" />
                ) : filteredRecords.length ===
                  0 ? (
                  <EmptyState text="目前沒有符合的乘車金紀錄" />
                ) : (
                  <table className="w-full min-w-[950px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-400">
                        <th className="px-4 py-3 font-medium">
                          時間
                        </th>
                        <th className="px-4 py-3 font-medium">
                          會員
                        </th>
                        <th className="px-4 py-3 font-medium">
                          類型
                        </th>
                        <th className="px-4 py-3 font-medium">
                          金額
                        </th>
                        <th className="px-4 py-3 font-medium">
                          原因
                        </th>
                        <th className="px-4 py-3 font-medium">
                          來源
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredRecords.map(
                        (record) => (
                          <tr
                            key={record.id}
                            className="border-b border-slate-100 last:border-0"
                          >
                            <td className="px-4 py-4 text-sm text-slate-500">
                              {formatDateTime(
                                record.createdAt
                              )}
                            </td>

                            <td className="px-4 py-4">
                              <p className="font-semibold">
                                {record.memberName ||
                                  "未填姓名"}
                              </p>
                              <p className="mt-1 text-xs font-semibold text-blue-600">
                                {record.memberCode ||
                                  "—"}
                              </p>
                            </td>

                            <td className="px-4 py-4 text-sm">
                              {getRecordTypeLabel(
                                record
                              )}
                            </td>

                            <td
                              className={`px-4 py-4 text-lg font-bold ${
                                record.amount >= 0
                                  ? "text-emerald-600"
                                  : "text-red-600"
                              }`}
                            >
                              {record.amount >= 0
                                ? "+"
                                : ""}
                              {formatMoney(
                                record.amount
                              )}
                            </td>

                            <td className="px-4 py-4 text-sm text-slate-600">
                              {record.reason ||
                                "—"}
                            </td>

                            <td className="px-4 py-4 text-sm text-slate-500">
                              {getSourceLabel(
                                record.source
                              )}
                            </td>
                          </tr>
                        )
                      )}
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
  danger = false,
}: {
  title: string;
  value: string;
  note: string;
  danger?: boolean;
}) {
  return (
    <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
      <p className="text-sm font-medium text-slate-500">
        {title}
      </p>

      <p
        className={`mt-4 text-3xl font-bold ${
          danger ? "text-red-600" : ""
        }`}
      >
        {value}
      </p>

      <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
        {note}
      </p>
    </article>
  );
}

function LoadingState({
  text,
}: {
  text: string;
}) {
  return (
    <div className="py-16 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

function EmptyState({
  text,
}: {
  text: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 py-16 text-center text-sm font-semibold text-slate-500">
      {text}
    </div>
  );
}

function Sidebar() {
  return (
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
          className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
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
          href="/credits"
          className="block rounded-xl bg-blue-500 px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          ▭　乘車金管理
        </Link>
      </nav>
    </aside>
  );
}

function MobileHeader() {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 lg:hidden">
      <div>
        <p className="font-bold">
          維尼車隊後台
        </p>
        <p className="text-xs text-slate-500">
          乘車金管理
        </p>
      </div>

      <Link
        href="/members"
        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-blue-600"
      >
        會員管理
      </Link>
    </div>
  );
}