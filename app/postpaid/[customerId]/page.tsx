"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";

type Customer = {
  customerCode: string;
  name: string;
  phone: string;
  balance: number;
  openingBalance: number;
  totalRides: number;
  totalPostpaidAmount: number;
  lineUserId: string;
  note: string;
  status: string;
  updatedAt?: Timestamp;
};

type TransactionRecord = {
  id: string;
  type: string;
  status: string;
  amount: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  rideDate: string;
  orderContent: string;
  source: string;
  createdAt?: Timestamp;
};

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

function getTypeLabel(type: string) {
  const labels: Record<string, string> = {
    ride_charge: "後結車資",
    payment: "收款入帳",
    deposit: "儲值入帳",
    adjustment: "手動調整",
    reversal: "帳務撤回",
  };

  return labels[type] ?? type;
}


function normalizeCustomerCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getCustomerDocumentId(customerCode: string) {
  return (await sha256Hex(normalizeCustomerCode(customerCode))).slice(0, 40);
}

export default function PostpaidCustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const router = useRouter();
  const customerId = Array.isArray(params.customerId)
    ? params.customerId[0]
    : params.customerId;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editCustomerCode, setEditCustomerCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLineUserId, setEditLineUserId] = useState("");
  const [editNote, setEditNote] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("payment");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customerId) return;

    const customerRef = doc(db, "postpaidCustomers", customerId);

    const unsubscribeCustomer = onSnapshot(
      customerRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setError("找不到這位後結客戶。");
          setLoading(false);
          return;
        }

        const data = snapshot.data();

        const nextCustomer: Customer = {
          customerCode: String(data.customerCode ?? ""),
          name: String(data.name ?? ""),
          phone: String(data.phone ?? ""),
          balance: Number(data.balance ?? 0),
          openingBalance: Number(data.openingBalance ?? 0),
          totalRides: Number(data.totalRides ?? 0),
          totalPostpaidAmount: Number(data.totalPostpaidAmount ?? 0),
          lineUserId: String(data.lineUserId ?? ""),
          note: String(data.note ?? ""),
          status: String(data.status ?? "active"),
          updatedAt:
            data.updatedAt instanceof Timestamp
              ? data.updatedAt
              : undefined,
        };

        setCustomer(nextCustomer);
        setEditCustomerCode(nextCustomer.customerCode);
        setEditName(nextCustomer.name);
        setEditPhone(nextCustomer.phone);
        setEditLineUserId(nextCustomer.lineUserId);
        setEditNote(nextCustomer.note);
        setLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("讀取後結客戶失敗。");
        setLoading(false);
      }
    );

    return unsubscribeCustomer;
  }, [customerId]);

  useEffect(() => {
    if (!customer?.customerCode) return;

    const transactionsQuery = query(
      collection(db, "postpaidTransactions"),
      where("customerCode", "==", customer.customerCode)
    );

    const unsubscribeTransactions = onSnapshot(
      transactionsQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            type: String(data.type ?? ""),
            status: String(data.status ?? "active"),
            amount: Number(data.amount ?? 0),
            previousBalance: Number(data.previousBalance ?? 0),
            newBalance: Number(data.newBalance ?? 0),
            reason: String(data.reason ?? ""),
            rideDate: String(data.rideDate ?? ""),
            orderContent: String(data.orderContent ?? ""),
            source: String(data.source ?? ""),
            createdAt:
              data.createdAt instanceof Timestamp
                ? data.createdAt
                : undefined,
          } satisfies TransactionRecord;
        });

        rows.sort((a, b) => {
          const aTime = a.createdAt?.toMillis() ?? 0;
          const bTime = b.createdAt?.toMillis() ?? 0;
          return bTime - aTime;
        });

        setTransactions(rows);
      }
    );

    return unsubscribeTransactions;
  }, [customer?.customerCode]);

  const activeTransactions = useMemo(
    () =>
      transactions.filter(
        (transaction) => transaction.status !== "reversed"
      ),
    [transactions]
  );

  async function saveCustomerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!customerId || !customer) return;

    const newCustomerCode = normalizeCustomerCode(editCustomerCode);
    const oldCustomerCode = normalizeCustomerCode(customer.customerCode);

    if (!newCustomerCode) {
      setError("客戶代號不能留空。");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const profileData = {
        customerCode: newCustomerCode,
        name: editName.trim(),
        phone: editPhone.trim(),
        lineUserId: editLineUserId.trim(),
        note: editNote.trim(),
        updatedAt: serverTimestamp(),
      };

      if (newCustomerCode === oldCustomerCode) {
        await updateDoc(doc(db, "postpaidCustomers", customerId), profileData);
        setMessage("客戶資料已更新。");
        return;
      }

      const confirmed = window.confirm(
        `確定要將客戶代號從「${customer.customerCode}」修改為「${newCustomerCode}」嗎？\n\n系統會保留餘額、LINE 綁定及歷史帳務。`
      );

      if (!confirmed) return;

      const newCustomerId = await getCustomerDocumentId(newCustomerCode);
      const oldCustomerRef = doc(db, "postpaidCustomers", customerId);
      const newCustomerRef = doc(db, "postpaidCustomers", newCustomerId);

      await runTransaction(db, async (transaction) => {
        const oldSnapshot = await transaction.get(oldCustomerRef);
        const newSnapshot = await transaction.get(newCustomerRef);

        if (!oldSnapshot.exists()) {
          throw new Error("原本的後結客戶資料已不存在。");
        }

        if (newSnapshot.exists() && newCustomerId !== customerId) {
          throw new Error(`客戶代號「${newCustomerCode}」已經存在。`);
        }

        transaction.set(
          newCustomerRef,
          {
            ...oldSnapshot.data(),
            ...profileData,
            customerCode: newCustomerCode,
            previousCustomerCode: oldCustomerCode,
            migratedAt: serverTimestamp(),
          },
          { merge: true }
        );

        if (newCustomerId !== customerId) {
          transaction.delete(oldCustomerRef);
        }
      });

      const transactionSnapshot = await getDocs(
        query(
          collection(db, "postpaidTransactions"),
          where("customerCode", "==", customer.customerCode)
        )
      );

      const registrySnapshot = await getDocs(
        query(
          collection(db, "sheetPostpaidRides"),
          where("customerCode", "==", customer.customerCode)
        )
      );

      const pendingLineSnapshot = await getDocs(
        query(
          collection(db, "pendingLineUsers"),
          where("boundCustomerId", "==", customerId)
        )
      );

      const docsToUpdate = [
        ...transactionSnapshot.docs.map((item) => ({
          ref: item.ref,
          data: {
            customerCode: newCustomerCode,
            customerName: editName.trim(),
            updatedAt: serverTimestamp(),
          },
        })),
        ...registrySnapshot.docs.map((item) => ({
          ref: item.ref,
          data: {
            customerCode: newCustomerCode,
            updatedAt: serverTimestamp(),
          },
        })),
        ...pendingLineSnapshot.docs.map((item) => ({
          ref: item.ref,
          data: {
            boundCustomerId: newCustomerId,
            boundCustomerCode: newCustomerCode,
            boundCustomerName: editName.trim(),
            updatedAt: serverTimestamp(),
          },
        })),
      ];

      for (let index = 0; index < docsToUpdate.length; index += 450) {
        const batch = writeBatch(db);

        docsToUpdate.slice(index, index + 450).forEach((item) => {
          batch.update(item.ref, item.data);
        });

        await batch.commit();
      }

      setMessage(
        `客戶代號已由「${customer.customerCode}」修改為「${newCustomerCode}」。`
      );

      router.replace(`/postpaid/${newCustomerId}`);
    } catch (saveError) {
      console.error(saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "更新客戶資料失敗。"
      );
    } finally {
      setSaving(false);
    }
  }

  async function createAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!customerId || !customer) return;

    const amount = Number(adjustmentAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("請輸入大於 0 的金額。");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const customerRef = doc(db, "postpaidCustomers", customerId);
      const transactionRef = doc(collection(db, "postpaidTransactions"));

      await runTransaction(db, async (transaction) => {
        const customerSnapshot = await transaction.get(customerRef);

        if (!customerSnapshot.exists()) {
          throw new Error("找不到後結客戶。");
        }

        const currentData = customerSnapshot.data();
        const previousBalance = Number(currentData.balance ?? 0);

        const delta =
          adjustmentType === "payment" ||
          adjustmentType === "deposit"
            ? amount
            : -amount;

        const newBalance = previousBalance + delta;

        transaction.update(customerRef, {
          balance: newBalance,
          updatedAt: serverTimestamp(),
        });

        transaction.set(transactionRef, {
          transactionId: transactionRef.id,
          customerCode: customer.customerCode,
          customerName: customer.name,
          amount: delta,
          inputAmount: amount,
          previousBalance,
          newBalance,
          type: adjustmentType,
          status: "active",
          reason:
            adjustmentReason.trim() ||
            (adjustmentType === "payment"
              ? "後台收款入帳"
              : adjustmentType === "deposit"
                ? "後台儲值入帳"
                : "後台手動扣款"),
          source: "admin_manual",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setAdjustmentAmount("");
      setAdjustmentReason("");
      setMessage("帳務調整已完成。");
    } catch (adjustmentError) {
      console.error(adjustmentError);
      setError(
        adjustmentError instanceof Error
          ? adjustmentError.message
          : "帳務調整失敗。"
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!customerId || !customer) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await updateDoc(doc(db, "postpaidCustomers", customerId), {
        status: customer.status === "active" ? "disabled" : "active",
        updatedAt: serverTimestamp(),
      });

      setMessage(
        customer.status === "active"
          ? "後結帳戶已停用。"
          : "後結帳戶已重新啟用。"
      );
    } catch (toggleError) {
      console.error(toggleError);
      setError("變更帳戶狀態失敗。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f4f7fb] p-8 text-slate-500">
        讀取中...
      </main>
    );
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-[#f4f7fb] p-8">
        <p className="text-red-600">{error || "找不到客戶"}</p>
        <Link href="/postpaid" className="mt-4 inline-block text-blue-600">
          返回後結帳務
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold text-blue-600">
              後結客戶帳務
            </p>
            <h1 className="mt-1 text-3xl font-bold">{customer.name}</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              客戶代號：{customer.customerCode}
            </p>
          </div>

          <div className="flex gap-3">
            <Link
              href="/postpaid"
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600"
            >
              返回名單
            </Link>
            <button
              onClick={toggleStatus}
              disabled={saving}
              className={`rounded-xl px-4 py-3 text-sm font-bold ${
                customer.status === "active"
                  ? "bg-red-50 text-red-600"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {customer.status === "active" ? "停用帳戶" : "重新啟用"}
            </button>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["目前餘額", formatMoney(customer.balance)],
            ["累積後結", formatMoney(customer.totalPostpaidAmount)],
            ["搭乘次數", `${customer.totalRides} 次`],
            ["LINE 狀態", customer.lineUserId ? "已綁定" : "尚未綁定"],
          ].map(([title, value]) => (
            <article
              key={title}
              className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
            >
              <p className="text-sm text-slate-500">{title}</p>
              <p className="mt-4 text-2xl font-bold">{value}</p>
            </article>
          ))}
        </section>

        {(message || error) && (
          <div
            className={`mt-5 rounded-xl px-4 py-3 text-sm ${
              error
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || message}
          </div>
        )}

        <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
          <form
            onSubmit={createAdjustment}
            className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
          >
            <h2 className="text-xl font-bold">帳務調整</h2>
            <p className="mt-1 text-sm text-slate-500">
              收款或儲值會增加餘額；手動扣款會減少餘額。
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label>
                <span className="text-sm font-bold">類型</span>
                <select
                  value={adjustmentType}
                  onChange={(event) =>
                    setAdjustmentType(event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                >
                  <option value="payment">收款入帳</option>
                  <option value="deposit">儲值入帳</option>
                  <option value="adjustment">手動扣款</option>
                </select>
              </label>

              <label>
                <span className="text-sm font-bold">金額</span>
                <input
                  type="number"
                  min="1"
                  value={adjustmentAmount}
                  onChange={(event) =>
                    setAdjustmentAmount(event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-sm font-bold">原因</span>
                <input
                  value={adjustmentReason}
                  onChange={(event) =>
                    setAdjustmentReason(event.target.value)
                  }
                  placeholder="例如：7/17 收款、補登儲值"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50"
            >
              確認帳務調整
            </button>
          </form>

          <form
            onSubmit={saveCustomerProfile}
            className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"
          >
            <h2 className="text-xl font-bold">客戶資料</h2>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="text-sm font-bold">客戶代號</span>
                <input
                  value={editCustomerCode}
                  onChange={(event) =>
                    setEditCustomerCode(event.target.value)
                  }
                  placeholder="例如：0059"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                />
                <p className="mt-2 text-xs text-slate-400">
                  修改代號後會保留餘額、LINE 綁定與歷史帳務。
                </p>
              </label>

              <label>
                <span className="text-sm font-bold">姓名</span>
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                />
              </label>

              <label>
                <span className="text-sm font-bold">手機</span>
                <input
                  value={editPhone}
                  onChange={(event) => setEditPhone(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-sm font-bold">LINE User ID</span>
                <input
                  value={editLineUserId}
                  onChange={(event) =>
                    setEditLineUserId(event.target.value)
                  }
                  placeholder="可先留空"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                />
              </label>

              <label className="md:col-span-2">
                <span className="text-sm font-bold">備註</span>
                <textarea
                  rows={4}
                  value={editNote}
                  onChange={(event) => setEditNote(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-xl bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-50"
            >
              {saving ? "儲存中..." : "儲存客戶資料"}
            </button>
          </form>
        </section>

        <section className="mt-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
          <div>
            <h2 className="text-xl font-bold">帳務明細</h2>
            <p className="mt-1 text-sm text-slate-500">
              目前共有 {activeTransactions.length} 筆有效帳務紀錄。
            </p>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-400">
                  <th className="px-3 py-4">時間</th>
                  <th className="px-3 py-4">類型</th>
                  <th className="px-3 py-4">金額</th>
                  <th className="px-3 py-4">變更前</th>
                  <th className="px-3 py-4">變更後</th>
                  <th className="px-3 py-4">行程／原因</th>
                  <th className="px-3 py-4">狀態</th>
                </tr>
              </thead>

              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-12 text-center text-sm text-slate-500"
                    >
                      尚無帳務紀錄
                    </td>
                  </tr>
                ) : (
                  transactions.map((record) => (
                    <tr
                      key={record.id}
                      className="border-b border-slate-100 text-sm"
                    >
                      <td className="px-3 py-5 text-xs text-slate-500">
                        {formatDate(record.createdAt)}
                      </td>
                      <td className="px-3 py-5 font-bold">
                        {getTypeLabel(record.type)}
                      </td>
                      <td
                        className={`px-3 py-5 font-bold ${
                          record.amount < 0
                            ? "text-red-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {formatMoney(record.amount)}
                      </td>
                      <td className="px-3 py-5">
                        {formatMoney(record.previousBalance)}
                      </td>
                      <td className="px-3 py-5">
                        {formatMoney(record.newBalance)}
                      </td>
                      <td className="px-3 py-5">
                        <p>{record.orderContent || record.reason || "—"}</p>
                        {record.rideDate && (
                          <p className="mt-1 text-xs text-slate-400">
                            {record.rideDate}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-5">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            record.status === "reversed"
                              ? "bg-red-100 text-red-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {record.status === "reversed" ? "已撤回" : "有效"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-5 text-xs text-slate-400">
          最後更新：{formatDate(customer.updatedAt)}
        </p>
      </div>
    </main>
  );
}