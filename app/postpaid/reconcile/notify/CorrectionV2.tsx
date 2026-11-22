"use client";

import { useState } from "react";

type Props = { code: string; currentBalance: number; onCorrected: () => Promise<void> };

export default function CorrectionV2({ code, currentBalance, onCorrected }: Props) {
  const [evidence, setEvidence] = useState("已逐筆核對10月與11月報表、11/9儲值及11/19人工更正，確認11/20第208、209列尚未入帳。");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  if (code !== "0059") return null;
  const canCorrect = currentBalance === -2442 && !complete;
  async function correct() {
    if (!canCorrect || busy || !confirmed || confirmation !== "確認補登0059" || evidence.trim().length < 12) return;
    if (!window.confirm("確定補登 0059 於 2026/11/20 第208、209列後結共 NT$1,370？\n此操作將真實扣除 Firebase 餘額，與 LINE 通知分開。")) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/postpaid/reconcile/notify/correct", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerCode: code, expectedBalance: currentBalance, confirmed, confirmation, evidence }),
      });
      const data = await res.json() as { success?: boolean; error?: string; newBalance?: number };
      if (!res.ok || !data.success) throw new Error(data.error || "補登失敗");
      setComplete(true);
      await onCorrected();
    } catch (err) { setError(err instanceof Error ? err.message : "補登失敗，請查看帳務紀錄"); }
    finally { setBusy(false); }
  }
  return <div className="my-4 rounded-xl border-2 border-blue-300 bg-blue-50 p-4">
    <h3 className="text-base font-bold">人工核對補登 V2｜0059（只限 11/20 兩筆）</h3>
    <p className="mt-2 text-sm">11/20 第 208 列 $850、第 209 列 $520，共 <strong>NT$1,370</strong>。</p>
    <p className="mt-1 text-sm">目前 Firebase：<strong>NT${currentBalance.toLocaleString("zh-TW")}</strong>　→　補登後預期：<strong>NT$-3,812</strong></p>
    <p className="mt-2 text-xs text-amber-800">10 月及 11/19 之前的人工更正均不重做；本補登與 LINE 通知分為兩個獨立操作。</p>
    {canCorrect ? <>
      <label className="mt-3 block text-sm">核對依據（至少 12 字）
        <textarea className="mt-1 w-full rounded border bg-white p-3" rows={3} value={evidence} onChange={e=>setEvidence(e.target.value)} /></label>
      <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
        已確認這兩筆未入帳，也不包含在 11/19 人工更正中。</label>
      <label className="mt-3 block text-sm">輸入確認文字：確認補登0059
        <input className="mt-1 w-full rounded border bg-white p-3" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
      <button type="button" onClick={correct} disabled={busy || !confirmed || evidence.trim().length<12 || confirmation!=="確認補登0059"}
        className="mt-3 rounded bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-40">{busy ? "補登中，請勿重複點擊…" : "確認補登 $1,370（更新帳本，不發 LINE）"}</button>
    </> : <p className="mt-3 rounded bg-white p-3 text-sm font-semibold text-green-700">
      {complete || currentBalance === -3812 ? "補登完成或帳本已是預期餘額；請核對最新通知內容，再決定是否發送。" : "目前餘額已與核對基準不同。已鎖定補登，請重新核對後台帳本。"}</p>}
    {error && <p role="alert" className="mt-3 rounded bg-red-100 p-3 text-sm text-red-700">{error}</p>}
  </div>;
}
