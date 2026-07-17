"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type PointRecord = {
  id: string;
  transactionId: string;
  memberCode: string;
  memberName: string;
  points: number;
  type: string;
  status: string;
  reason: string;
  source: string;

  spreadsheetId: string;
  sheetName: string;
  blockName: string;
  sheetRow: number;
  rideDate: string;
  orderContent: string;
  plate: string;

  rewardAmount: number;
  stableRideId: string;

  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  reversedAt: Timestamp | null;
  reversedReason: string;
};

type StatusFilter =
  | "all"
  | "active"
  | "reversed";

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

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getTimestampValue(value: unknown) {
  return value instanceof Timestamp ? value : null;
}

function getSourceLabel(source: string) {
  if (source === "google_sheets_report") {
    return "報表自動集點";
  }

  if (source === "admin_manual_test") {
    return "後台手動測試";
  }

  return source || "其他來源";
}

export default function PointsPage() {
  const [records, setRecords] = useState<PointRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");

  const [reversingId, setReversingId] =
    useState("");

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const snapshot = await getDocs(
        collection(db, "pointTransactions")
      );

      const result: PointRecord[] = snapshot.docs.map(
        (recordDocument) => {
          const data = recordDocument.data();

          return {
            id: recordDocument.id,

            transactionId: String(
              data.transactionId ?? recordDocument.id
            ),

            memberCode: String(data.memberCode ?? ""),
            memberName: String(data.memberName ?? ""),
            points: Number(data.points ?? 0),
            type: String(data.type ?? "earn"),

            // 舊紀錄可能沒有 status，預設視為有效
            status: String(data.status ?? "active"),

            reason: String(data.reason ?? ""),
            source: String(data.source ?? ""),

            spreadsheetId: String(
              data.spreadsheetId ?? ""
            ),

            sheetName: String(data.sheetName ?? ""),
            blockName: String(data.blockName ?? ""),
            sheetRow: Number(data.sheetRow ?? 0),
            rideDate: String(data.rideDate ?? ""),
            orderContent: String(
              data.orderContent ?? ""
            ),
            plate: String(data.plate ?? ""),

            rewardAmount: Number(
              data.rewardAmount ?? 0
            ),

            stableRideId: String(
              data.stableRideId ?? ""
            ),

            createdAt: getTimestampValue(
              data.createdAt
            ),

            updatedAt: getTimestampValue(
              data.updatedAt
            ),

            reversedAt: getTimestampValue(
              data.reversedAt
            ),

            reversedReason: String(
              data.reversedReason ?? ""
            ),
          };
        }
      );

      result.sort((a, b) => {
        const aTime =
          a.createdAt?.toMillis() ?? 0;

        const bTime =
          b.createdAt?.toMillis() ?? 0;

        return bTime - aTime;
      });

      setRecords(result);
    } catch (error) {
      console.error("讀取集點紀錄失敗：", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "無法讀取集點紀錄"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const reversePointRecord = useCallback(
    async (record: PointRecord) => {
      if (record.status === "reversed") {
        window.alert("這筆集點已經撤回。");
        return;
      }

      if (!record.memberCode) {
        window.alert("這筆紀錄沒有會員編號，無法撤回。");
        return;
      }

      const reasonInput = window.prompt(
        "請輸入撤回原因：",
        "後台手動撤回"
      );

      if (reasonInput === null) {
        return;
      }

      const reason =
        reasonInput.trim() || "後台手動撤回";

      const confirmed = window.confirm(
        `確定要撤回 ${record.memberCode} 的 ${record.points} 點嗎？\n\n會員：${record.memberName || "未填姓名"}\n原因：${reason}`
      );

      if (!confirmed) {
        return;
      }

      setReversingId(record.id);
      setErrorMessage("");

      try {
        const pointRef = doc(
          db,
          "pointTransactions",
          record.id
        );

        const memberRef = doc(
          db,
          "members",
          record.memberCode
        );

        const registryRef = record.stableRideId
          ? doc(
              db,
              "sheetMemberRides",
              record.stableRideId
            )
          : null;

        await runTransaction(
          db,
          async (transaction) => {
            const pointSnapshot =
              await transaction.get(pointRef);

            if (!pointSnapshot.exists()) {
              throw new Error(
                "找不到這筆集點紀錄。"
              );
            }

            const pointData =
              pointSnapshot.data();

            if (
              String(
                pointData.status ?? "active"
              ) === "reversed"
            ) {
              throw new Error(
                "這筆集點已經撤回，不能重複操作。"
              );
            }

            const memberSnapshot =
              await transaction.get(memberRef);

            if (!memberSnapshot.exists()) {
              throw new Error(
                `找不到會員 ${record.memberCode}。`
              );
            }

            let registrySnapshot = null;

            if (registryRef) {
              registrySnapshot =
                await transaction.get(
                  registryRef
                );
            }

            const memberData =
              memberSnapshot.data();

            const pointAmount = Math.max(
              0,
              Number(
                pointData.points ??
                  record.points ??
                  0
              )
            );

            const rewardAmount = Math.max(
              0,
              Number(
                pointData.rewardAmount ??
                  record.rewardAmount ??
                  0
              )
            );

            const currentPoints = Math.max(
              0,
              Number(memberData.points ?? 0)
            );

            const currentTotalRides = Math.max(
              0,
              Number(memberData.totalRides ?? 0)
            );

            const currentRideCredit = Math.max(
              0,
              Number(memberData.rideCredit ?? 0)
            );

            const currentPendingRecovery =
              Math.max(
                0,
                Number(
                  memberData.pendingCreditRecovery ??
                    0
                )
              );

            const restoredPoints =
              rewardAmount > 0
                ? currentPoints -
                  pointAmount +
                  10
                : currentPoints -
                  pointAmount;

            const newPoints = Math.max(
              0,
              restoredPoints
            );

            const desiredCredit =
              currentRideCredit -
              rewardAmount;

            const newRideCredit = Math.max(
              0,
              desiredCredit
            );

            const newPendingRecovery =
              currentPendingRecovery +
              Math.max(0, -desiredCredit);

            transaction.update(pointRef, {
              status: "reversed",
              reversedReason: reason,
              reversedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              reversedBy: "admin_dashboard",
            });

            transaction.update(memberRef, {
              points: newPoints,
              totalRides: Math.max(
                0,
                currentTotalRides - 1
              ),
              rideCredit: newRideCredit,
              pendingCreditRecovery:
                newPendingRecovery,
              needsManualReview:
                newPendingRecovery > 0,
              updatedAt: serverTimestamp(),
            });

            if (
              registryRef &&
              registrySnapshot &&
              registrySnapshot.exists()
            ) {
              transaction.update(
                registryRef,
                {
                  status: "reversed",
                  reversedReason: reason,
                  reversedAt:
                    serverTimestamp(),
                  updatedAt:
                    serverTimestamp(),
                }
              );
            }

            if (rewardAmount > 0) {
              const creditRecordRef = doc(
                collection(
                  db,
                  "rideCreditTransactions"
                )
              );

              transaction.set(
                creditRecordRef,
                {
                  transactionId:
                    creditRecordRef.id,
                  sourcePointTransactionId:
                    record.transactionId ||
                    record.id,
                  stableRideId:
                    record.stableRideId || "",
                  memberCode:
                    record.memberCode,
                  memberName:
                    record.memberName || "",
                  amount: -rewardAmount,
                  type: "reversal",
                  status: "active",
                  reason,
                  source:
                    "admin_dashboard",
                  pendingCreditRecovery:
                    newPendingRecovery,
                  createdAt:
                    serverTimestamp(),
                }
              );
            }
          }
        );

        window.alert("集點已成功撤回。");
        await loadRecords();
      } catch (error) {
        console.error(
          "撤回集點失敗：",
          error
        );

        const message =
          error instanceof Error
            ? error.message
            : "撤回集點失敗";

        setErrorMessage(message);
        window.alert(message);
      } finally {
        setReversingId("");
      }
    },
    [loadRecords]
  );

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const filteredRecords = useMemo(() => {
    const keyword = searchText
      .trim()
      .toLowerCase();

    return records.filter((record) => {
      if (
        statusFilter !== "all" &&
        record.status !== statusFilter
      ) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return [
        record.memberCode,
        record.memberName,
        record.sheetName,
        record.blockName,
        record.orderContent,
        record.plate,
        record.reason,
        record.reversedReason,
      ].some((value) =>
        value.toLowerCase().includes(keyword)
      );
    });
  }, [records, searchText, statusFilter]);

  const activeRecords = records.filter(
    (record) => record.status !== "reversed"
  );

  const reversedRecords = records.filter(
    (record) => record.status === "reversed"
  );

  const activePoints = activeRecords.reduce(
    (total, record) =>
      total + Math.max(record.points, 0),
    0
  );

  const rewardAmount = activeRecords.reduce(
    (total, record) =>
      total + Math.max(record.rewardAmount, 0),
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
                  會員集點系統
                </p>

                <h1 className="mt-1 text-3xl font-bold">
                  集點紀錄
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                  查看報表自動集點、撤回紀錄與乘車金兌換狀況。
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadRecords()}
                disabled={loading}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "整理中…" : "重新整理"}
              </button>
            </header>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                title="全部紀錄"
                value={`${records.length} 筆`}
                note="包含有效與已撤回紀錄"
              />

              <SummaryCard
                title="有效集點"
                value={`${activePoints} 點`}
                note={`${activeRecords.length} 筆有效紀錄`}
              />

              <SummaryCard
                title="已撤回"
                value={`${reversedRecords.length} 筆`}
                note="報表刪除、取消或作廢"
              />

              <SummaryCard
                title="觸發乘車金"
                value={formatMoney(rewardAmount)}
                note="有效集點紀錄所觸發的獎勵"
              />
            </section>

            <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 md:p-6">
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
                <div>
                  <h2 className="text-xl font-bold">
                    集點明細
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    可搜尋會員編號、姓名、報表分頁、車牌或派單內容。
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target
                          .value as StatusFilter
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="all">
                      全部狀態
                    </option>

                    <option value="active">
                      只看有效
                    </option>

                    <option value="reversed">
                      只看已撤回
                    </option>
                  </select>

                  <input
                    value={searchText}
                    onChange={(event) =>
                      setSearchText(
                        event.target.value
                      )
                    }
                    placeholder="搜尋集點紀錄…"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 sm:w-80"
                  />
                </div>
              </div>

              {errorMessage && (
                <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {errorMessage}
                </div>
              )}

              <div className="mt-6 hidden overflow-x-auto lg:block">
                {loading ? (
                  <LoadingState />
                ) : filteredRecords.length === 0 ? (
                  <EmptyState />
                ) : (
                  <table className="w-full min-w-[1150px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-400">
                        <th className="px-3 py-3 font-medium">
                          時間
                        </th>

                        <th className="px-3 py-3 font-medium">
                          會員
                        </th>

                        <th className="px-3 py-3 font-medium">
                          點數
                        </th>

                        <th className="px-3 py-3 font-medium">
                          狀態
                        </th>

                        <th className="px-3 py-3 font-medium">
                          行程日期
                        </th>

                        <th className="px-3 py-3 font-medium">
                          報表位置
                        </th>

                        <th className="px-3 py-3 font-medium">
                          派單內容
                        </th>

                        <th className="px-3 py-3 font-medium">
                          來源
                        </th>

                        <th className="px-3 py-3 font-medium">
                          乘車金
                        </th>

                        <th className="px-3 py-3 font-medium">
                          操作
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredRecords.map(
                        (record) => (
                          <PointTableRow
                            key={record.id}
                            record={record}
                            reversing={
                              reversingId === record.id
                            }
                            onReverse={
                              reversePointRecord
                            }
                          />
                        )
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="mt-5 space-y-4 lg:hidden">
                {loading ? (
                  <LoadingState />
                ) : filteredRecords.length === 0 ? (
                  <EmptyState />
                ) : (
                  filteredRecords.map((record) => (
                    <PointMobileCard
                      key={record.id}
                      record={record}
                      reversing={
                        reversingId === record.id
                      }
                      onReverse={
                        reversePointRecord
                      }
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function PointTableRow({
  record,
  reversing,
  onReverse,
}: {
  record: PointRecord;
  reversing: boolean;
  onReverse: (
    record: PointRecord
  ) => Promise<void>;
}) {
  const reversed =
    record.status === "reversed";

  return (
    <tr
      className={`border-b border-slate-100 last:border-0 ${
        reversed ? "bg-red-50/40" : ""
      }`}
    >
      <td className="px-3 py-4 text-sm text-slate-500">
        {formatDateTime(record.createdAt)}
      </td>

      <td className="px-3 py-4">
        <p className="font-semibold text-slate-900">
          {record.memberName || "未填姓名"}
        </p>

        <Link
          href={`/member-card/${record.memberCode}`}
          className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline"
        >
          {record.memberCode || "無編號"}
        </Link>
      </td>

      <td className="px-3 py-4">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            reversed
              ? "bg-red-100 text-red-700 line-through"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          +{record.points} 點
        </span>
      </td>

      <td className="px-3 py-4">
        <StatusBadge record={record} />
      </td>

      <td className="px-3 py-4 text-sm text-slate-600">
        {record.rideDate || "—"}
      </td>

      <td className="px-3 py-4 text-sm text-slate-600">
        <p>{record.sheetName || "—"}</p>

        <p className="mt-1 text-xs text-slate-400">
          {record.blockName || "報表"}
          {record.sheetRow > 0
            ? `｜第 ${record.sheetRow} 列`
            : ""}
        </p>
      </td>

      <td className="max-w-[320px] px-3 py-4">
        <p className="line-clamp-2 text-sm leading-6 text-slate-700">
          {record.orderContent || "—"}
        </p>

        {record.plate && (
          <p className="mt-1 text-xs text-slate-400">
            車牌：{record.plate}
          </p>
        )}

        {reversed &&
          record.reversedReason && (
            <p className="mt-2 text-xs font-medium text-red-600">
              撤回原因：
              {record.reversedReason}
            </p>
          )}
      </td>

      <td className="px-3 py-4 text-sm text-slate-500">
        {getSourceLabel(record.source)}
      </td>

      <td className="px-3 py-4 font-semibold">
        {record.rewardAmount > 0
          ? formatMoney(record.rewardAmount)
          : "—"}
      </td>

      <td className="px-3 py-4">
        {reversed ? (
          <span className="text-xs font-semibold text-slate-400">
            已完成撤回
          </span>
        ) : (
          <button
            type="button"
            onClick={() =>
              void onReverse(record)
            }
            disabled={reversing}
            className="whitespace-nowrap rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reversing
              ? "撤回中…"
              : "撤回集點"}
          </button>
        )}
      </td>
    </tr>
  );
}

function PointMobileCard({
  record,
  reversing,
  onReverse,
}: {
  record: PointRecord;
  reversing: boolean;
  onReverse: (
    record: PointRecord
  ) => Promise<void>;
}) {
  const reversed =
    record.status === "reversed";

  return (
    <article
      className={`rounded-2xl border p-5 ${
        reversed
          ? "border-red-100 bg-red-50/50"
          : "border-slate-100 bg-slate-50/60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-slate-900">
            {record.memberName || "未填姓名"}
          </p>

          <Link
            href={`/member-card/${record.memberCode}`}
            className="mt-1 inline-block text-sm font-semibold text-blue-600"
          >
            {record.memberCode}
          </Link>
        </div>

        <StatusBadge record={record} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoItem
          title="點數"
          value={`+${record.points} 點`}
        />

        <InfoItem
          title="行程日期"
          value={record.rideDate || "—"}
        />

        <InfoItem
          title="報表分頁"
          value={record.sheetName || "—"}
        />

        <InfoItem
          title="報表列數"
          value={
            record.sheetRow > 0
              ? `第 ${record.sheetRow} 列`
              : "—"
          }
        />
      </div>

      <div className="mt-4 rounded-xl bg-white p-4">
        <p className="text-xs font-medium text-slate-400">
          派單內容
        </p>

        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
          {record.orderContent || "—"}
        </p>
      </div>

      {reversed &&
        record.reversedReason && (
          <div className="mt-3 rounded-xl bg-red-100 px-4 py-3 text-sm font-medium text-red-700">
            撤回原因：
            {record.reversedReason}
          </div>
        )}

      {!reversed && (
        <button
          type="button"
          onClick={() =>
            void onReverse(record)
          }
          disabled={reversing}
          className="mt-4 w-full rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {reversing
            ? "撤回中…"
            : "撤回這筆集點"}
        </button>
      )}

      <p className="mt-4 text-xs text-slate-400">
        建立時間：
        {formatDateTime(record.createdAt)}
      </p>
    </article>
  );
}

function StatusBadge({
  record,
}: {
  record: PointRecord;
}) {
  if (record.status === "reversed") {
    return (
      <span className="whitespace-nowrap rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
        已撤回
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
      有效
    </span>
  );
}

function InfoItem({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs text-slate-400">
        {title}
      </p>

      <p className="mt-1 text-sm font-semibold text-slate-800">
        {value}
      </p>
    </div>
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
      <p className="text-sm font-medium text-slate-500">
        {title}
      </p>

      <p className="mt-4 text-3xl font-bold tracking-tight">
        {value}
      </p>

      <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
        {note}
      </p>
    </article>
  );
}

function LoadingState() {
  return (
    <div className="py-16 text-center text-sm text-slate-400">
      正在讀取集點紀錄…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-slate-50 py-16 text-center">
      <p className="font-semibold text-slate-600">
        目前沒有符合的集點紀錄
      </p>

      <p className="mt-2 text-sm text-slate-400">
        報表出現會員編號並同步後，紀錄會顯示在這裡。
      </p>
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
          className="block rounded-xl bg-blue-500 px-4 py-3 text-sm font-medium text-white shadow-lg"
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
          集點紀錄
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