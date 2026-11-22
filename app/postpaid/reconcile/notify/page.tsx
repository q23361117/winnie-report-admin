"use client";

import Link from "next/link";
import { useState } from "react";

type Account = {
  code: string; name: string; status: string; currentBalance: number | null;
  chargeDifference: number; paymentDifference: number; warnings: string[];
};
type Scan = { success: boolean; error?: string; accounts: Account[]; warnings: string[] };
type Preview = {
  success: boolean; error?: string; customerCode: string; customerName: string;
  currentBalance: number; noticeId: string; message: string; priorStatus: string;
};

export default function NotifyPostpaidPage() {
  const [months, setMonths] = useState<string[]>(["2026-10", "2026-11"]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [search, setSearch] = useState("");

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const result = await res.json();
    if (!res.ok || !result.success) throw new Error(String(result.error || `請求失敗：${res.status}`));
    return result;
  }
  async function scanReports() {
    if (!months.length) return setError("請選擇至少一個月份");
    setBusy(true); setError(""); setSuccess(""); setScan(null); setPreview(null);
    try { setScan(await post("/api/postpaid/reconcile", { months }) as Scan); }
    catch (e) { setError(e instanceof Error ? e.message : "掃描失敗"); }
    finally { setBusy(false); }
  }
  async function choose(code: string) {
    setBusy(true); setError(""); setSuccess(""); setPreview(null);
    setEvidence(""); setConfirmed(false); setConfirmation("");
    try { setPreview(await post("/api/postpaid/reconcile/notify", { action: "preview", customerCode: code }) as Preview); }
    catch (e) { setError(e instanceof Error ? e.message : "無法預覽"); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!preview || sending) return;
    if (!window.confirm(`確定將代號 ${preview.customerCode} 的已核對餘額以 LINE 發送給客戶？\n此操作只通知，不修改餘額。`)) return;
    setSending(true); setError(""); setSuccess("");
    try {
      const result = await post("/api/postpaid/reconcile/notify", {
        action: "send", customerCode: preview.customerCode, noticeId: preview.noticeId,
        evidence, confirmed, confirmation,
      }) as { success: boolean; message: string };
      setSuccess(result.message);
      setPreview({ ...preview, priorStatus: "accepted" });
    } catch (e) { setError(e instanceof Error ? e.message : "通知失敗"); }
    finally { setSending(false); }
  }
  const accounts = scan?.accounts.filter(a => `${a.code} ${a.name}`.toLowerCase().includes(search.toLowerCase())) || [];
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div><p className="text-sm font-bold text-blue-600">後結帳務管理</p>
          <h1 className="mt-1 text-2xl font-bold">對帳結果 LINE 通知中心 V1</h1>
          <p className="mt-2 text-sm text-slate-600">先人工確認正確餘額，再單筆通知客戶；本頁不會修改餘額、不會重新計算或補扣歷史車資。</p></div>
        <Link href="/postpaid/reconcile" className="rounded-lg border bg-white px-4 py-2 text-sm">回一鍵對帳</Link>
      </header>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold">1. 按鈕掃描核對報表（僅讀取）</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {["2026-10", "2026-11"].map(m => <label key={m} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={months.includes(m)} onChange={() => setMonths(old => old.includes(m) ? old.filter(x => x !== m) : [...old,m])}/>{m}</label>)}
          <button onClick={scanReports} disabled={busy || sending} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "查詢中…" : "一鍵核對並載入客戶"}</button>
        </div>
        <p className="mt-3 text-xs text-amber-700">報表金額不等於目前餘額。掃描差異須先查明；對帳有差異時不能直接把掃描結果當成正確餘額。</p>
      </section>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>}
      {scan && <section className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold">2. 選擇要通知的後結客戶</h2>
        {(scan.warnings || []).map((w,i)=><p className="mt-2 text-xs text-amber-700" key={i}>⚠ {w}</p>)}
        <input className="mt-3 w-full rounded-lg border p-3 text-sm md:w-80" placeholder="搜尋代號或姓名" value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-100"><tr>
          <th className="p-3">客戶</th><th className="p-3">目前 Firebase 餘額</th><th className="p-3">掃描結果</th><th className="p-3">操作</th>
        </tr></thead><tbody>{accounts.map(a=><tr key={a.code} className="border-b">
          <td className="p-3 font-medium">{a.code}　{a.name}</td>
          <td className="p-3">{a.currentBalance === null ? "未建檔" : `NT$${a.currentBalance.toLocaleString("zh-TW")}`}</td>
          <td className="p-3">{a.status === "MATCH_TOTALS" ? "總額一致（仍須查期初）" : "有差異／需人工核實"}</td>
          <td className="p-3"><button disabled={busy || a.currentBalance === null || a.status === "INCOMPLETE" || a.status === "MISSING_CUSTOMER"}
            onClick={()=>choose(a.code)} className="rounded-md border border-blue-500 px-3 py-2 text-blue-700 disabled:opacity-40">查看通知</button></td>
        </tr>)}</tbody></table></div>
      </section>}
      {preview && <section className="rounded-xl border-2 border-amber-300 bg-white p-5">
        <h2 className="font-bold">3. 人工確認並發送：{preview.customerCode} {preview.customerName}</h2>
        <p className="mt-2 text-sm">目前餘額：<strong>NT${preview.currentBalance.toLocaleString("zh-TW")}</strong></p>
        {preview.priorStatus !== "not_sent" && <p className="mt-2 rounded bg-red-50 p-3 text-sm font-semibold text-red-700">
          已有相同餘額的通知紀錄：{preview.priorStatus}。為避免重複發送，本版不允許再次推送。</p>}
        <p className="mt-3 text-sm font-medium">發給客戶的 LINE 文字預覽（不可直接修改帳務金額）</p>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-sm leading-7">{preview.message}</pre>
        <button className="mt-2 rounded border px-3 py-2 text-sm" onClick={()=>navigator.clipboard.writeText(preview.message)}>複製通知內容</button>
        <label className="mt-4 block text-sm font-medium">人工核對依據（至少 12 字）
          <textarea rows={3} className="mt-1 w-full rounded-lg border p-3" value={evidence} onChange={e=>setEvidence(e.target.value)}
            placeholder="例如：11/22 逐筆核對 10、11 月報表、實收與既有更正紀錄，確認帳戶餘額" /></label>
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
          我已人工核對客戶身分、正確餘額、收款及更正紀錄，確認可以對客戶通知；不是只憑月總額推算。</label>
        <label className="mt-4 block text-sm font-medium">確認文字：確認通知{preview.customerCode}
          <input className="mt-1 w-full rounded-lg border p-3" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
        <button disabled={sending || busy || !confirmed || evidence.trim().length < 12 || confirmation !== `確認通知${preview.customerCode}` || preview.priorStatus !== "not_sent"}
          onClick={send} className="mt-4 rounded-lg bg-amber-600 px-6 py-3 font-bold text-white disabled:opacity-40">{sending ? "通知傳送中…" : "確認並傳送 LINE（不修改帳務）"}</button>
        <p className="mt-3 text-xs text-slate-500">傳送結果記錄在 Firestore postpaidReconcileNotices；LINE API 接受後仍需確認客戶是否實際收到。</p>
      </section>}
    </div>
  </main>;
}
