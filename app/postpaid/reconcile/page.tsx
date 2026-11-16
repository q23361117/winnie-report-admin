"use client";

import Link from "next/link";
import { useState } from "react";

type Row = { key: string; month: string; sheet: string; row: number; date: string; order: string; charge: number; payment: number };
type Account = {
  code: string; name: string; firestoreCustomerId: string | null;
  currentBalance: number | null; openingBalance: number | null;
  reportCount: number; reportCharge: number; reportPayment: number;
  ledgerCount: number; ledgerCharge: number; ledgerPayment: number;
  chargeDifference: number; paymentDifference: number;
  status: string; rows: Row[]; warnings: string[];
};
type Result = { success: boolean; months: string[]; generatedAt: string; scannedSheets: number;
  scannedRows: number; firestoreDocumentReadsUpperBound: number; accounts: Account[]; warnings: string[]; error?: string };
const cash = (value: number | null) => value === null ? "尚未建檔" : `NT$ ${value.toLocaleString("zh-TW")}`;

export default function PostpaidReconcilePage() {
  const [months, setMonths] = useState<string[]>(["2026-10", "2026-11"]);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [adjusting, setAdjusting] = useState<Account | null>(null);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [opId, setOpId] = useState("");

  function toggleMonth(month: string) {
    setMonths((old) => old.includes(month) ? old.filter((x) => x !== month) : [...old, month].sort());
  }
  async function scan() {
    if (!months.length) { setError("請至少選擇一個月份"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/postpaid/reconcile", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months }), cache: "no-store",
      });
      const json = await response.json() as Result;
      if (!response.ok || !json.success) throw new Error(json.error || "掃描失敗");
      setResult(json);
    } catch (err) { setError(err instanceof Error ? err.message : "掃描失敗"); }
    finally { setLoading(false); }
  }
  function openAdjustment(account: Account) {
    setAdjusting(account); setTarget(""); setReason(""); setConfirmation(""); setOpId(crypto.randomUUID()); setError("");
  }
  async function saveAdjustment() {
    if (!adjusting || adjusting.currentBalance === null || !adjusting.firestoreCustomerId) return;
    if (!/^-?\d+$/.test(target.trim())) { setError("目標餘額請輸入整數，例如 -430"); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/postpaid/reconcile/adjust", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: adjusting.firestoreCustomerId, customerCode: adjusting.code,
          expectedBalance: adjusting.currentBalance, targetBalance: Number(target), reason, operationId: opId, confirmation }),
      });
      const json = await response.json() as {success?: boolean; error?: string; newBalance?: number};
      if (!response.ok || !json.success) throw new Error(json.error || "更正失敗");
      setResult((old) => old ? ({ ...old, accounts: old.accounts.map((c) => c.code === adjusting.code ?
        { ...c, currentBalance: Number(json.newBalance) } : c) }) : old);
      setAdjusting(null);
      window.alert("更正交易已成功提交，新的客戶餘額已更新。請重新掃描確認。 ");
    } catch (err) { setError(err instanceof Error ? err.message : "更正失敗"); }
    finally { setSaving(false); }
  }
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-900 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-bold text-blue-600">後結帳務管理</p>
            <h1 className="mt-1 text-3xl font-bold">一鍵報表對帳</h1>
            <p className="mt-2 text-sm text-slate-600">只有管理員按下掃描才讀取 10、11 月報表；預設唯讀，不會重新扣款或推送 LINE。</p></div>
          <Link href="/postpaid" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">返回後結帳務</Link>
        </header>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm font-bold">選擇核對月份</p>
          <div className="mt-3 flex flex-wrap items-center gap-5">
            {["2026-10", "2026-11"].map((month) => <label key={month} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={months.includes(month)} onChange={() => toggleMonth(month)}/>{month}</label>)}
            <button onClick={scan} disabled={loading || months.length === 0}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">
              {loading ? "正在核對 Google 報表與 Firestore…" : "一鍵掃描全部後結客戶"}</button>
          </div>
          <p className="mt-3 text-xs text-amber-700">安全規則：掃描不會修改餘額。月總額一致仍須核對逐筆交易與期初餘額；本頁不自動套用差額。</p>
        </section>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {result && <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">核對結果</h2>
          <p className="mt-1 text-sm text-slate-500">掃描分頁 {result.scannedSheets} 個、有效帳務列 {result.scannedRows} 筆、Firestore 文件讀取估算 {result.firestoreDocumentReadsUpperBound} 次。{result.generatedAt.replace("T", " ").slice(0,19)} UTC</p>
          {(result.warnings || []).map((w,i)=><p key={i} className="mt-2 text-sm text-amber-700">⚠ {w}</p>)}
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-100"><tr>{["客戶","報表車資","報表收款","帳本車資","帳本收款","目前餘額","差異","明細與更正"].map((h)=><th className="px-3 py-3" key={h}>{h}</th>)}</tr></thead>
            <tbody>{result.accounts.map((a)=><tr key={a.code} className="border-b align-top">
              <td className="px-3 py-3 font-semibold">{a.code}<p className="text-xs font-normal text-slate-500">{a.name}</p></td>
              <td className="px-3 py-3">{cash(a.reportCharge)}</td><td className="px-3 py-3">{cash(a.reportPayment)}</td>
              <td className="px-3 py-3">{cash(a.ledgerCharge)}</td><td className="px-3 py-3">{cash(a.ledgerPayment)}</td>
              <td className="px-3 py-3">{cash(a.currentBalance)}</td>
              <td className="px-3 py-3"><span className={a.status === "MATCH_TOTALS" ? "text-emerald-700" : "font-bold text-amber-700"}>{a.status === "MATCH_TOTALS" ? "總額一致，待查交易ID" : "需要核對"}</span>
                <p className="text-xs text-slate-500">車資 {a.chargeDifference >= 0 ? "+" : ""}{a.chargeDifference}／收款 {a.paymentDifference >= 0 ? "+" : ""}{a.paymentDifference}</p></td>
              <td className="space-y-2 px-3 py-3"><button onClick={() => setExpanded((old) => old.includes(a.code) ? old.filter(x=>x!==a.code):[...old,a.code])} className="block rounded border px-3 py-1">{expanded.includes(a.code)?"收合":"查看明細"}</button>
                {a.firestoreCustomerId && !a.warnings.some((w)=>w.includes("不完整")) && <button onClick={()=>openAdjustment(a)} className="rounded border border-amber-300 px-3 py-1 text-amber-800">人工更正</button>}</td>
            </tr>)}</tbody></table></div>
          {result.accounts.filter(a=>expanded.includes(a.code)).map(a=><div key={a.code} className="mt-5 rounded-xl border p-4">
            <h3 className="font-bold">{a.code} 報表明細（{a.rows.length} 筆）</h3>
            {a.warnings.map((w,i)=><p key={i} className="mt-1 text-sm text-amber-700">⚠ {w}</p>)}
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead><tr className="bg-slate-100">{["月份","日期","分頁","列號","訂單","後結","收款"].map(v=><th key={v} className="p-2">{v}</th>)}</tr></thead>
              <tbody>{a.rows.map(r=><tr className="border-b" key={r.key}><td className="p-2">{r.month}</td><td className="p-2">{r.date}</td><td className="p-2">{r.sheet}</td><td className="p-2">{r.row}</td><td className="p-2">{r.order}</td><td className="p-2">{cash(r.charge)}</td><td className="p-2">{cash(r.payment)}</td></tr>)}</tbody></table></div>
          </div>)}
        </section>}
        {adjusting && <section className="rounded-2xl border-2 border-amber-300 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">人工更正｜{adjusting.code}</h2>
          <p className="mt-2 text-sm">目前餘額：<strong>{cash(adjusting.currentBalance)}</strong>。這是獨立補正交易，不會刪除或重播歷史訂單。</p>
          <p className="mt-2 text-sm text-amber-700">請先備份及確認實際期初餘額、現金收款、已使用乘車金。0532 人工確認 -430；天 -610；0059 尚未核定最終餘額。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">目標餘額（欠款填負數）<input className="mt-1 block w-full rounded border p-3" value={target} onChange={e=>setTarget(e.target.value)} placeholder="例如 -430" /></label>
            <label className="text-sm">確認文字<input className="mt-1 block w-full rounded border p-3" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={`確認更正${adjusting.code}`} /></label></div>
          <label className="mt-3 block text-sm">核對依據（最少 12 字）<textarea className="mt-1 block w-full rounded border p-3" rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：11/13 人工逐筆確認 10–11 月報表及收款明細，確認期末欠款 430 元" /></label>
          <div className="mt-4 flex gap-3"><button disabled={saving} onClick={saveAdjustment} className="rounded-xl bg-amber-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? "提交更正中…" : "確認並建立更正交易"}</button>
          <button onClick={()=>setAdjusting(null)} className="rounded-xl border px-5 py-3">取消</button></div>
          <p className="mt-3 text-xs text-slate-500">正式更正功能預設關閉，只有設定部署環境變數 WINNIE_RECONCILE_WRITE_ENABLED=true 才能提交；所有操作記錄在 postpaidBalanceAdjustments。</p>
        </section>}
      </div>
    </main>
  );
}
