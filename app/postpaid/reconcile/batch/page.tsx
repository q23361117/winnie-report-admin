"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

type Account = { code: string; name: string; status: string; currentBalance: number | null; warnings?: string[] };
type ScanResponse = { success: boolean; error?: string; accounts: Account[]; warnings?: string[] };
type Candidate = { key: string; month: string; sheet: string; row: number; date: string; order: string; charge: number; status: string; reason: string };
type CandidateResponse = { success: boolean; error?: string; code: string; balance: number; rows: Candidate[]; manualAdjustmentCount: number; needsExtraReview: boolean; warning?: string };
type Preview = { success: boolean; error?: string; customerCode: string; customerName: string; currentBalance: number; noticeId: string; message: string; priorStatus: string };
type Stage = "idle" | "loaded" | "corrected" | "sent" | "skipped" | "error";
type Item = {
  code: string; name: string; sourceBalance: number;
  data?: CandidateResponse; selected: string[]; evidence: string;
  legacyReviewed: boolean; checked: boolean; notifyChecked: boolean; notifyEvidence: string;
  preview?: Preview; correctionStatus: Stage; noticeStatus: Stage;
  error?: string; info?: string;
};
const codeOf = (x: string) => x.trim().toUpperCase() === "059" ? "0059" : x.trim().toUpperCase();
const fmt = (v: number) => `NT$${v.toLocaleString("zh-TW")}`;
async function api<T extends { success: boolean; error?: string }>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result: T = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
export default function PostpaidBatchV4() {
  const [months, setMonths] = useState<string[]>(["2026-10", "2026-11"]);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [items, setItems] = useState<Record<string, Item>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [backfillPhrase, setBackfillPhrase] = useState("");
  const [notifyPhrase, setNotifyPhrase] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const update = useCallback((code: string, patch: Partial<Item>) => setItems(prev => ({ ...prev, [code]: { ...prev[code], ...patch } })), []);
  const accountList = useMemo(() => (scan?.accounts || []).filter(a => a.currentBalance !== null && a.status !== "INCOMPLETE" && a.status !== "MISSING_CUSTOMER").map(a => ({ ...a, code: codeOf(a.code) })).filter((a,i,arr) => arr.findIndex(x=>x.code === a.code) === i), [scan]);
  const ordered = accountList.filter(x => `${x.code} ${x.name}`.toLowerCase().includes(filter.toLowerCase()));
  const selectedTotal = Object.values(items).reduce((total,item) => total + (item.data?.rows || []).filter(r=>item.selected.includes(r.key)).reduce((v,r)=>v+r.charge,0),0);
  const readyToCorrect = Object.values(items).filter(item => item.data && !item.data.needsExtraReview && item.selected.length > 0 && item.selected.length <= 10 && item.checked && item.legacyReviewed && item.evidence.trim().length >= 20 && item.correctionStatus !== "corrected" && item.correctionStatus !== "sent" && item.selected.every(k=>item.data?.rows.some(r=>r.key===k && r.status==="manual_review_required")));
  const readyToNotify = Object.values(items).filter(item => item.preview && item.preview.priorStatus === "not_sent" && item.notifyChecked && item.notifyEvidence.trim().length >= 12 && item.noticeStatus !== "sent");

  async function scanAll() {
    if (!months.length) return setError("請勾選至少一個月份");
    setBusy(true); setError(""); setProgress("正在唯讀掃描後結客戶…"); setItems({}); setExpanded({}); setScan(null); setBackfillPhrase(""); setNotifyPhrase("");
    try {
      const response = await api<ScanResponse>("/api/postpaid/reconcile", { months });
      setScan(response);
      setProgress(`完成：報表包含 ${response.accounts.length} 位客戶；尚未補登或發送 LINE`);
    } catch (e) { setError(e instanceof Error?e.message:"掃描失敗"); }
    finally {setBusy(false);}
  }
  async function loadCandidates() {
    if (!accountList.length) return;
    setBusy(true);setError("");
    const next: Record<string,Item> = {};
    for (let i=0;i<accountList.length;i++) {
      const a=accountList[i];
      setProgress(`讀取 ${i+1}/${accountList.length}：${a.code} ${a.name}（僅查帳）`);
      const item:Item={ code:a.code,name:a.name,sourceBalance:a.currentBalance as number,selected:[],evidence:"",legacyReviewed:false,checked:false,notifyChecked:false,notifyEvidence:"",correctionStatus:"idle",noticeStatus:"idle" };
      try {
        const data=await api<CandidateResponse>("/api/postpaid/reconcile/notify/backfill",{action:"candidates",customerCode:a.code,months});
        item.data=data;item.correctionStatus="loaded";item.sourceBalance=data.balance;
        if(data.needsExtraReview)item.info="既有資料讀取達上限：禁止批次補登";
      } catch(e) {item.error=e instanceof Error?e.message:"候選讀取失敗";item.correctionStatus="error";}
      next[a.code]=item;setItems({ ...next });
    }
    setProgress("完成逐筆核對候選讀取；沒有自動選取任何交易，亦無扣款與發訊息");setBusy(false);
  }
  async function backfillBatch() {
    if(busy || backfillPhrase!=="確認批次補登" || !readyToCorrect.length) return;
    const rows=readyToCorrect.map(i=>`${i.code}：${i.selected.length} 筆／${fmt((i.data?.rows||[]).filter(r=>i.selected.includes(r.key)).reduce((n,r)=>n+r.charge,0))}`).join("\n");
    if(!window.confirm(`只補登下列已核准的交易；不會發 LINE：\n${rows}\n\n確定要寫入 Firebase？`)) return;
    setBusy(true);setError("");setBackfillPhrase("");
    for(let k=0;k<readyToCorrect.length;k++) {
      const item=readyToCorrect[k];setProgress(`批次補登 ${k+1}/${readyToCorrect.length}：${item.code}`);
      try {
        const result=await api<{success:boolean;error?:string;newBalance:number;operationId:string}>("/api/postpaid/reconcile/notify/backfill",{
          action:"correct",customerCode:item.code,months,keys:item.selected,
          expectedBalance:item.data?.balance,evidence:item.evidence,confirmed:true,legacyReviewed:true,
          confirmation:`確認補登${item.code}`,
        });
        update(item.code,{correctionStatus:"corrected",selected:[],info:`補登成功，最新餘額 ${fmt(result.newBalance)}；操作 ID：${result.operationId}`,preview:undefined,notifyChecked:false,noticeStatus:"idle"});
      }catch(e){update(item.code,{correctionStatus:"error",error:e instanceof Error?e.message:"補登失敗，勿直接重試"});}
    }
    setProgress("本批次補登流程結束。請確認每位結果；有錯誤／結果不明者先查帳本，不要重複提交。");setBusy(false);
  }
  async function previewAll() {
    if(!accountList.length) return;
    setBusy(true);setError("");
    for(let i=0;i<accountList.length;i++) {
      const a=accountList[i];setProgress(`取得最新通知預覽 ${i+1}/${accountList.length}：${a.code}`);
      try {
        const result=await api<Preview>("/api/postpaid/reconcile/notify",{action:"preview",customerCode:a.code});
        setItems(prev=>({ ...prev,[a.code]:{...(prev[a.code] || {code:a.code,name:a.name,sourceBalance:a.currentBalance||0,selected:[],evidence:"",legacyReviewed:false,checked:false,notifyChecked:false,notifyEvidence:"",correctionStatus:"idle",noticeStatus:"idle"}),preview:result,noticeStatus:result.priorStatus==="not_sent"?"loaded":"skipped",notifyChecked:false,notifyEvidence:"",error:undefined} }));
      }catch(e){update(a.code,{noticeStatus:"error",error:e instanceof Error?e.message:"預覽失敗"});}
    }
    setProgress("預覽完成。僅勾選已人工核對的客戶，才能批次傳送 LINE；已通知的餘額會跳過。");setBusy(false);
  }
  async function notifyBatch() {
    if(busy || notifyPhrase!=="確認批次通知" || !readyToNotify.length)return;
    const recipients=readyToNotify.map(i=>`${i.code} ${i.name}：${fmt(i.preview?.currentBalance || 0)}`).join("\n");
    if(!window.confirm(`此操作會真正發送 LINE（不是測試）。\n請確認每位餘額均已核實：\n${recipients}\n\n確定通知嗎？`))return;
    setBusy(true);setNotifyPhrase("");setError("");
    for(let j=0;j<readyToNotify.length;j++) {
      const item=readyToNotify[j];setProgress(`LINE 發送 ${j+1}/${readyToNotify.length}：${item.code}`);
      try {
        const result=await api<{success:boolean;error?:string;message:string}>("/api/postpaid/reconcile/notify",{
          action:"send",customerCode:item.code,noticeId:item.preview?.noticeId,evidence:item.notifyEvidence,
          confirmed:true,confirmation:`確認通知${item.code}`,
        });
        update(item.code,{noticeStatus:"sent",notifyChecked:false,preview:item.preview?{...item.preview,priorStatus:"accepted"}:undefined,info:result.message});
      }catch(e){update(item.code,{noticeStatus:"error",notifyChecked:false,error:`通知未確認成功：${e instanceof Error?e.message:"未知錯誤"}。請查通知紀錄與 LINE 聊天室，不要立即重發。`});}
    }
    setProgress("批次通知流程結束。LINE API 接受不代表客人已讀；請核對聊天室與發送紀錄。");setBusy(false);
  }
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8"><div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-blue-700">後結帳務管理</p><h1 className="mt-1 text-2xl font-bold">全客戶批次對帳、補登與 LINE 通知 V4</h1><p className="mt-2 text-sm text-slate-600">按鈕觸發才查歷史報表；不重複補扣；補登與通知分開確認，不自動發送。</p></div><Link href="/postpaid/reconcile/notify" className="rounded border bg-white px-4 py-2 text-sm">返回單客戶通知</Link></header>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-bold">1. 一次唯讀掃描所有後結客戶</h2><div className="mt-3 flex flex-wrap items-center gap-4">
      {["2026-10","2026-11"].map(m=><label key={m} className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={months.includes(m)} onChange={()=>setMonths(v=>v.includes(m)?v.filter(x=>x!==m):[...v,m])}/>{m}</label>)}
      <button type="button" disabled={busy} onClick={scanAll} className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">一鍵掃描全部客戶</button>
      <button type="button" disabled={busy||!accountList.length} onClick={loadCandidates} className="rounded bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-50">讀取所有逐筆候選（僅查帳）</button></div>
      <p className="mt-2 text-xs text-amber-800">歷史人工更正如果沒有來源列號，系統不能證明未匹配交易就是漏帳。全部候選預設不勾選，必須人工核實。</p></section>
    {progress&&<p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-900">{busy?"處理中：":""}{progress}</p>}{error&&<p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
    {scan&&<section className="rounded-xl border bg-white p-5"><h2 className="font-bold">2. 全客戶逐筆核對與勾選</h2><p className="mt-2 text-sm">報表客戶：{scan.accounts.length} 位｜可讀取帳本：{accountList.length} 位｜目前選取補登金額：<strong>{fmt(selectedTotal)}</strong></p>
      {(scan.warnings||[]).map((w,i)=><p key={i} className="mt-1 text-xs text-amber-800">⚠ {w}</p>)}
      <input type="search" className="mt-3 w-full max-w-sm rounded border p-2" placeholder="搜尋客戶代號、姓名" value={filter} onChange={e=>setFilter(e.target.value)}/>
      <div className="mt-4 space-y-3">{ordered.map(a=>{
        const item=items[a.code];const selected=(item?.data?.rows||[]).filter(r=>item.selected.includes(r.key));const total=selected.reduce((n,r)=>n+r.charge,0);
        return <div key={a.code} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{a.code} {a.name}</strong> <span className="ml-2 text-sm">目前 {fmt(item?.data?.balance??a.currentBalance??0)}</span><span className="ml-2 text-xs text-slate-500">{item?.correctionStatus==="corrected"?"補登成功":item?.error?"需處理":item?.data?"候選已讀取":"尚未讀取"}</span></div><button className="rounded border px-3 py-1 text-sm" onClick={()=>setExpanded(p=>({...p,[a.code]:!p[a.code]}))}>{expanded[a.code]?"收合":"查看／核對"}</button></div>
          {item?.info&&<p className="mt-2 text-sm text-green-800">{item.info}</p>}{item?.error&&<p role="alert" className="mt-2 text-sm text-red-800">{item.error}</p>}
          {expanded[a.code]&&<div className="mt-3 border-t pt-3">
            {!item?.data?<p className="text-sm text-amber-800">尚未讀取此客戶逐筆候選。請先按上方「讀取所有逐筆候選」。</p>:<>
              <p className="text-sm">既有人工調整：{item.data.manualAdjustmentCount} 筆；待核對候選：{item.data.rows.filter(r=>r.status==="manual_review_required").length} 筆</p>
              {item.data.needsExtraReview&&<p className="mt-2 text-red-700">來源讀取達上限：禁止此客戶批次補登。</p>}
              <div className="mt-2 max-h-72 overflow-auto border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">勾選</th><th>日期／來源</th><th>後結</th><th>訂單</th><th>核對狀態</th></tr></thead><tbody>{item.data.rows.map(r=><tr key={r.key} className="border-t"><td className="p-2"><input type="checkbox" disabled={busy||r.status!=="manual_review_required"||item.data?.needsExtraReview||item.correctionStatus==="corrected"} checked={item.selected.includes(r.key)} onChange={e=>update(a.code,{selected:e.target.checked?[...item.selected,r.key]:item.selected.filter(k=>k!==r.key),checked:false,legacyReviewed:false})}/></td><td className="p-2">{r.date}<br/>{r.month} {r.sheet} 第 {r.row} 列</td><td className="p-2">{fmt(r.charge)}</td><td className="p-2">{r.order}</td><td className="p-2">{r.status==="already_recorded"?"已入帳，不可重複":"人工確認"}<br/>{r.reason}</td></tr>)}</tbody></table></div>
              <p className="mt-2 text-sm font-semibold">已選 {selected.length} 筆（每位每次最多10筆）｜本客戶補登 {fmt(total)}｜預計餘額 {fmt(item.data.balance-total)}</p>
              <textarea rows={2} className="mt-2 w-full rounded border p-2 text-sm" placeholder="逐筆核對依據，至少20字；說明歷史調整涵蓋範圍及各筆為何確定尚未入帳" value={item.evidence} disabled={busy} onChange={e=>update(a.code,{evidence:e.target.value})}/>
              <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={item.legacyReviewed} onChange={e=>update(a.code,{legacyReviewed:e.target.checked})}/>已檢查本客戶既有人工更正、儲值及歷史漏帳，不會重複入帳</label>
              <label className="mt-1 flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={item.checked} onChange={e=>update(a.code,{checked:e.target.checked})}/>確認勾選的每筆均未入帳，也不是已收現金或取消作廢的車資</label>
            </>}
          </div>}
        </div>;
      })}</div></section>}
    {scan&&<section className="rounded-xl border border-amber-300 bg-amber-50 p-5"><h2 className="font-bold">3. 批次確認補登（不發 LINE）</h2><p className="mt-2 text-sm">符合逐筆人工核對條件：{readyToCorrect.length} 位｜已勾選補登共 {fmt(readyToCorrect.reduce((n,i)=>n+(i.data?.rows||[]).filter(r=>i.selected.includes(r.key)).reduce((s,r)=>s+r.charge,0),0))}</p>
      <p className="mt-2 text-xs text-amber-800">每位補登前 API 會重新查最新餘額、來源與已補登記錄；部分成功部分失敗時，絕不可重新批次送出已成功者。</p>
      <input className="mt-3 w-full max-w-sm rounded border bg-white p-2" placeholder="輸入：確認批次補登" value={backfillPhrase} disabled={busy} onChange={e=>setBackfillPhrase(e.target.value)}/>
      <button className="ml-2 rounded bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-40" type="button" disabled={busy||!readyToCorrect.length||backfillPhrase!=="確認批次補登"} onClick={backfillBatch}>批次確認補登 {readyToCorrect.length} 位</button></section>}
    {scan&&<section className="rounded-xl border bg-white p-5"><h2 className="font-bold">4. 重新讀取餘額、逐位預覽並批次 LINE 通知</h2><button disabled={busy} onClick={previewAll} className="mt-3 rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-40">取得全客戶最新通知預覽（僅讀取）</button>
      <p className="mt-2 text-sm text-amber-800">未完成核對者不要勾選。歷史已發過通知的同一餘額會略過；LINE 發送結果不明時不能自動重試。</p>
      <div className="mt-3 space-y-3">{ordered.map(a=>{const item=items[a.code];return item?.preview?<div key={a.code} className="rounded border p-3"><div className="flex flex-wrap items-center gap-3"><strong>{a.code} {a.name}</strong><span>最新 {fmt(item.preview.currentBalance)}</span><span className="text-xs text-slate-500">通知狀態：{item.preview.priorStatus}</span><button className="rounded border px-2 py-1 text-xs" onClick={()=>setExpanded(p=>({...p,[`notice:${a.code}`]:!p[`notice:${a.code}`]}))}>{expanded[`notice:${a.code}`]?"收合預覽":"查看完整 LINE 預覽"}</button></div>
          {expanded[`notice:${a.code}`]&&<pre className="mt-2 whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs">{item.preview.message}</pre>}
          {item.preview.priorStatus==="not_sent"?<><textarea className="mt-2 w-full rounded border p-2 text-sm" rows={2} placeholder="此客戶人工核對依據（至少12字）" value={item.notifyEvidence} disabled={busy} onChange={e=>update(a.code,{notifyEvidence:e.target.value})}/><label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={item.notifyChecked} disabled={busy} onChange={e=>update(a.code,{notifyChecked:e.target.checked})}/>已核對該客戶身分、收款、調整紀錄和最新餘額，同意發送</label></>:<p className="mt-2 text-sm text-amber-800">此餘額已有通知紀錄，不會重複發送。</p>}
          {item.info&&<p className="mt-2 text-sm text-green-800">{item.info}</p>}{item.error&&<p className="mt-2 text-sm text-red-800">{item.error}</p>}
        </div>:null;})}</div>
      <p className="mt-4 text-sm">已核准批次通知：<strong>{readyToNotify.length}</strong> 位</p><input className="mt-2 w-full max-w-sm rounded border p-2" placeholder="輸入：確認批次通知" value={notifyPhrase} disabled={busy} onChange={e=>setNotifyPhrase(e.target.value)}/>
      <button type="button" className="ml-2 rounded bg-green-700 px-4 py-2 font-semibold text-white disabled:opacity-40" disabled={busy||!readyToNotify.length||notifyPhrase!=="確認批次通知"} onClick={notifyBatch}>確認批次發送 LINE {readyToNotify.length} 位</button></section>}
  </div></main>;
}
