"use client";
import { useEffect, useState } from "react";

type Item = {key:string;month:string;sheet:string;row:number;date:string;order:string;charge:number;status:string;reason:string};
type Data = {success:boolean;error?:string;balance:number;rows:Item[];manualAdjustmentCount:number;needsExtraReview:boolean;warning:string};
type Props = {code:string;currentBalance:number;months:string[];onCorrected:()=>Promise<void>};

export default function CorrectionV3({code,currentBalance,months,onCorrected}:Props) {
  const [data,setData]=useState<Data|null>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const [evidence,setEvidence]=useState("");
  const [checked,setChecked]=useState(false);
  const [legacyReviewed,setLegacyReviewed]=useState(false);
  const [confirmation,setConfirmation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const monthKey=months.join("|");
  useEffect(()=>{setData(null);setSelected([]);setEvidence("");setChecked(false);setLegacyReviewed(false);setConfirmation("");setError("");setNotice("");},[code,currentBalance,monthKey]);
  async function post(action:string,extra:Record<string,unknown>={}) {
    const response=await fetch("/api/postpaid/reconcile/notify/backfill",{
      method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action,customerCode:code,months,...extra})});
    const result=await response.json() as Data & {newBalance?:number;message?:string};
    if(!response.ok||!result.success) throw new Error(result.error||`操作失敗 (${response.status})`);
    return result;
  }
  async function load() {
    setBusy(true);setError("");setNotice("");setSelected([]);
    try{setData(await post("candidates"));}catch(e){setError(e instanceof Error?e.message:"掃描失敗");}
    finally{setBusy(false);}
  }
  const sum=(data?.rows||[]).filter(r=>selected.includes(r.key)).reduce((n,r)=>n+r.charge,0);
  async function correct() {
    if(!data||busy||data.balance!==currentBalance||!selected.length||!checked||!legacyReviewed||confirmation!==`確認補登${code}`||evidence.trim().length<20) return;
    if(!window.confirm(`確認對 ${code} 補登 ${selected.length} 筆，合計 NT$${sum.toLocaleString("zh-TW")}？\n補登後會真實更新 Firebase 餘額，但不會自動傳 LINE。`))return;
    setBusy(true);setError("");setNotice("");
    try{
      const result=await post("correct",{keys:selected,expectedBalance:currentBalance,evidence,confirmed:checked,legacyReviewed,confirmation});
      setNotice(result.message||`補登完成，新的餘額為 NT$${result.newBalance}`);
      setData(null);setSelected([]);await onCorrected();
    }catch(e){setError(e instanceof Error?e.message:"補登失敗，請檢查帳務明細，不要直接重試");}
    finally{setBusy(false);}
  }
  return <section className="my-4 rounded-xl border-2 border-blue-300 bg-blue-50 p-4">
    <h3 className="font-bold">全客戶逐筆查帳與漏帳補登 V3｜{code}</h3>
    <p className="mt-2 text-sm text-slate-700">只在按下時讀取所選月份報表，不自動扣款。先排除已入帳及人工更正涵蓋的交易，再選取真正漏帳。</p>
    <button type="button" disabled={busy} onClick={load} className="mt-3 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?"處理中…":"讀取本客戶逐筆候選"}</button>
    {data&&<>
      <div className="mt-3 rounded bg-white p-3 text-sm">目前餘額：<b>NT${data.balance.toLocaleString("zh-TW")}</b>　既有人工調整：{data.manualAdjustmentCount} 筆<br/>
        <span className="text-amber-800">{data.warning}</span>
        {data.needsExtraReview&&<p className="font-bold text-red-700">讀取達上限，不能執行補登；請先查明歷史來源。</p>}
      </div>
      <div className="mt-3 max-h-80 overflow-auto rounded border bg-white">
        <table className="w-full min-w-[740px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>
          <th className="p-2">選取</th><th className="p-2">日期／列號</th><th className="p-2">後結</th><th className="p-2">訂單</th><th className="p-2">判斷</th>
        </tr></thead><tbody>{data.rows.map(r=><tr key={r.key} className="border-t">
          <td className="p-2"><input type="checkbox" disabled={r.status!=="manual_review_required"||busy||data.needsExtraReview}
            checked={selected.includes(r.key)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.key]:old.filter(x=>x!==r.key))}/></td>
          <td className="p-2">{r.month} {r.date}<br/>{r.sheet} 第 {r.row} 列</td>
          <td className="p-2">${r.charge.toLocaleString("zh-TW")}</td><td className="p-2">{r.order}</td>
          <td className="p-2">{r.status==="already_recorded"?"禁止重複補登":"需人工逐筆核實"}<br/><span className="text-amber-800">{r.reason}</span></td>
        </tr>)}</tbody></table>
      </div>
      <p className="mt-3 text-sm font-semibold">已選 {selected.length} 筆｜補登合計 NT${sum.toLocaleString("zh-TW")}｜預計餘額 NT${(currentBalance-sum).toLocaleString("zh-TW")}</p>
      <label className="mt-3 block text-sm">逐筆核對依據（至少20字）<textarea rows={3} value={evidence} onChange={e=>setEvidence(e.target.value)}
        className="mt-1 w-full rounded border bg-white p-3" placeholder="列明各筆交易、收款、歷史更正範圍及為何確定未入帳"/></label>
      <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={legacyReviewed} onChange={e=>setLegacyReviewed(e.target.checked)}/>
        我已檢查既有人工更正及儲值，確認勾選交易沒有包含在先前帳務調整內。</label>
      <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>
        我確認本次僅補登勾選的真實漏帳，不含已付現金或已補登交易。</label>
      <label className="mt-3 block text-sm">確認文字：確認補登{code}<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="mt-1 w-full rounded border bg-white p-3"/></label>
      <button type="button" onClick={correct} disabled={busy||data.needsExtraReview||data.balance!==currentBalance||!selected.length||selected.length>10||!checked||!legacyReviewed||evidence.trim().length<20||confirmation!==`確認補登${code}`}
        className="mt-3 rounded bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-40">確認補登 ${sum.toLocaleString("zh-TW")}（不發 LINE）</button>
      <p className="mt-2 text-xs text-amber-800">每次最多10筆。舊人工更正若無來源列號，程式無法自動判斷是否涵蓋，請人工核對後才勾選。</p>
    </>}
    {notice&&<p role="status" className="mt-3 rounded bg-green-100 p-3 text-green-900">{notice}</p>}
    {error&&<p role="alert" className="mt-3 rounded bg-red-100 p-3 text-red-800">{error}</p>}
  </section>;
}
