import "server-only";
import crypto from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";

/**
 * Winnie 後結唯讀對帳：報表讀取不觸動 Firestore，帳本按客戶代號有限量查詢。
 * 需要把 Google Sheets 分享給 FIREBASE_SERVICE_ACCOUNT_BASE64 內的 client_email，
 * 並在相同 Google Cloud project 啟用 Google Sheets API。
 */
const REPORTS = {
  "2026-10": "12voznV1LuUdXEEswI3iHiV1seAhOc2DSrKThRPd7Vfc",
  "2026-11": "1bYKuBjuLJQGBk7Bu-daOxrlITXxojB63zRACXCqj2Ew",
} as const;

export type ReportMonth = keyof typeof REPORTS;
export const SCAN_MONTHS = Object.keys(REPORTS) as ReportMonth[];
const MAX_TRANSACTION_ROWS_PER_CODE = 350;
const MAX_WORKSHEET_ROWS = 2000;
const SCANNABLE_TABS = [
  "⚖️維尼", "⚖️0666後結", "⚖️快+50", "⚖️天+50", "⚖️調度丟單",
  "⚖️SF+50", "⚖️啾咪+50", "⚖️全全省+50",
  "⚖️店1/大統領中清路一段53號", "取消費登記",
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function money(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : 0;
  const raw = text(value).replace(/,/g, "").replace(/[ＮＴ＄$元\s]/g, "");
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function colIndex(headers: unknown[], choices: string[]): number {
  return headers.findIndex((h) => choices.some((s) => text(h).replace(/[\s／/]/g, "").includes(s)));
}

function sheetNameA1(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function sheetsToken(): Promise<string> {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!encoded) throw new Error("環境變數缺少 FIREBASE_SERVICE_ACCOUNT_BASE64");
  const credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    client_email?: string; private_key?: string;
  };
  if (!credentials.client_email || !credentials.private_key) throw new Error("Service Account 不完整");
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtPayload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3500,
  }));
  const unsigned = `${jwtHeader}.${jwtPayload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), credentials.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json() as {access_token?: string; error_description?: string};
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google Sheets 授權失敗：${payload.error_description || response.status}`);
  }
  return payload.access_token;
}

const norm = (v: unknown) => text(v).normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const member = (v: unknown) => norm(v).split(/[\/|,、]+/).find(v => /^V\d{2,}$/.test(v)) || '';
function dateOf(value: unknown, month: string) {
  const s = text(value); const m = s.match(/^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})$/);
  if (!m) return ''; const y = m[1] || month.slice(0,4);
  const d = `${y}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return d.startsWith(month+'-') && Number(m[3]) >= 1 && Number(m[3]) <= 31 ? d : '';
}
export type Ride = { cancelColumnKnown:boolean; spreadsheetId:string; sheetId:string; code:string; date:string; sheet:string; row:number; order:string; plate:string; fare:number };
type Ledger = { id:string; date:string; order:string; plate:string; points:number; status:string; source:string; type:string; sheet:string; row:number };
async function readRides(month:ReportMonth, token:string, warnings:string[]) {
  const meta=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${REPORTS[month]}?fields=sheets(properties(sheetId,title))`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!meta.ok) throw new Error(`${month} 無法讀取分頁識別碼`);
  const metadata=await meta.json() as {sheets?: {properties:{sheetId:number;title:string}}[]};
  const ids=new Map((metadata.sheets||[]).map(s=>[s.properties.title,String(s.properties.sheetId)]));
  const params=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});
  for(const tab of SCANNABLE_TABS) params.append('ranges',`${sheetNameA1(tab)}!A1:R${MAX_WORKSHEET_ROWS}`);
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${REPORTS[month]}/values:batchGet?${params}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(40000)});
  if(!res.ok) throw new Error(`${month} 報表讀取失敗 (${res.status})`);
  const data=await res.json() as {valueRanges?: {values?: unknown[][]}[]};
  if(data.valueRanges?.length!==SCANNABLE_TABS.length) throw new Error('分頁回傳不完整');
  const rides:Ride[]=[];
  data.valueRanges.forEach((range,i)=>{
    const sheet=SCANNABLE_TABS[i], rows=range.values||[], h=rows[0]||[];
    if(rows.length>=MAX_WORKSHEET_ROWS) warnings.push(`${month} ${sheet} 達列數上限`);
    const c=colIndex(h,['客人代號','客戶代號']), d=colIndex(h,['日期']), o=colIndex(h,['單號']), p=colIndex(h,['車牌']), f=colIndex(h,['總車資','付現','現金']), a=colIndex(h,['後結']), x=colIndex(h,['取消']);
    if(Math.min(c,d,o)<0 || (f<0&&a<0)){warnings.push(`${month} ${sheet} 欄位不足，略過`);return;}
    if(x<0) warnings.push(`${month} ${sheet} 未辨識取消欄，需人工確認`);
    rows.slice(2).forEach((r,j)=>{
      const code=member(r[c]), order=text(r[o]), date=dateOf(r[d],month), fare=money(r[f])+money(r[a]);
      if(!code||!order||!date||fare<=0||money(r[x])>0||/取消|作廢|未搭乘|空趟|儲值|收款/.test(order)) return;
      rides.push({cancelColumnKnown:x>=0,spreadsheetId:REPORTS[month],sheetId:ids.get(sheet)??"",code,date,sheet,row:j+3,order,plate:text(r[p]),fare});
    });
  });return rides;
}
export function rideKey(r:Ride){return crypto.createHash('sha256').update(JSON.stringify([r.spreadsheetId,r.sheetId,r.code,r.date,norm(r.order),norm(r.plate)])).digest('hex').slice(0,40);}
// Restrict writes to the verified primary report layout; other tabs remain read-only.
function xSafe(r:Ride){return r.sheet==='⚖️維尼'&&r.cancelColumnKnown&&!/跑腿|代購|代駕|送貨/.test(r.order);}
export async function reconcileMembers(months:ReportMonth[]){
  const warnings:string[]=[];const token=await sheetsToken();
  const rides=(await Promise.all(months.map(m=>readRides(m,token,warnings)))).flat();
  const snap=await adminDb.collection('members').limit(501).get();
  if(snap.size>500) throw new Error('會員超過500位，請分批');
  let reads=snap.size;
  const profiles=new Map(snap.docs.map(d=>[norm(d.data().memberCode||d.id),d.data()]));
  const codes=[...new Set([...profiles.keys(),...rides.map(r=>r.code)])].sort((a,b)=>a.localeCompare(b,'zh-TW',{numeric:true}));
  const accounts=[];
  for(const code of codes){
    const rows=rides.filter(r=>r.code===code), profile=profiles.get(code);
    const ledger:Ledger[]=[];let incomplete=false;
    if(rows.length){
      if(reads+MAX_TRANSACTION_ROWS_PER_CODE+1>10000) incomplete=true;
      else {
        const q=await adminDb.collection('pointTransactions').where('memberCode','==',code).limit(MAX_TRANSACTION_ROWS_PER_CODE+1).get();
        reads+=Math.max(1,q.size); incomplete=q.size>MAX_TRANSACTION_ROWS_PER_CODE;
        q.docs.forEach(doc=>{const v=doc.data();ledger.push({id:doc.id,date:text(v.rideDate),order:text(v.orderContent),plate:text(v.plate),points:Number(v.points||0),status:text(v.status)||'active',source:text(v.source),type:text(v.type),sheet:text(v.sheetName),row:Number(v.sheetRow||0)});});
      }
    }
    const active=ledger.filter(t=>t.status==='active'&&t.source==='google_sheets_report'&&t.type==='earn'&&t.points===1);
    const key=(r:Ride)=>[r.date,norm(r.order),norm(r.plate)].join('|');
    const matches=rows.map(r=>{
      const day=ledger.filter(t=>t.date===r.date), strong=active.filter(t=>t.date===r.date&&norm(t.order)===norm(r.order)&&!!r.plate&&norm(t.plate)===norm(r.plate));
      const repeated=rows.filter(x=>key(x)===key(r)).length>1;
      const status=incomplete?'查詢不完整':!profile?'無會員主檔':repeated||strong.length>1?'疑似重複／需核對':strong.length===1?'強配對（待確認）':day.length?'同日紀錄待核對':'疑似漏點';
      return {...r,key:rideKey(r),repairable:status==='疑似漏點'&&r.date<'2026-11-20'&&!!r.plate&&!!r.sheetId&&xSafe(r),status,candidates:day.map(t=>({...t,strong:strong.some(x=>x.id===t.id)}))};
    });
    accounts.push({code,name:text(profile?.name),points:profile?Number(profile.points??0):null,rideCredit:profile?Number(profile.rideCredit??0):null,totalRides:profile?Number(profile.totalRides??0):null,reportCount:rows.length,ledgerCount:rows.length?active.filter(t=>months.some(m=>t.date.startsWith(m+'-'))).length:null,missing:matches.filter(r=>r.status==='疑似漏點').length,incomplete,rows:matches});
  }
  return {accounts,warnings,reads,generatedAt:new Date().toISOString(),reportCount:rides.length,readOnly:true};
}
