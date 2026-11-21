import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getAdminSession } from '@/lib/admin-session';
import { reconcileMembers } from '@/lib/member-reconciliation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const fail=(error:string,status=400)=>NextResponse.json({error},{status});
const norm=(v:unknown)=>String(v??'').trim().normalize('NFKC').replace(/\s+/g,'').toUpperCase();
const numeric=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export async function POST(req:NextRequest){
 if(req.headers.get('origin')!==req.nextUrl.origin)return fail('禁止跨站請求',403);
 const admin=await getAdminSession(); if(!admin)return fail('請重新登入管理員',401);
 if(process.env.WINNIE_MEMBER_REPAIR_ENABLED!=='true')return fail('修復權限未開啟（WINNIE_MEMBER_REPAIR_ENABLED）',423);
 try{
  const b=await req.json(); const code=String(b.code??'');const reason=String(b.reason??'').trim();
  if(!/^V\d{2,10}$/.test(code)||b.confirmation!==`確認修復${code}`||reason.length<12||reason.length>500)return fail('確認文字或核對依據不正確');
  const keys:unknown=b.keys;
  if(!Array.isArray(keys)||keys.length>30||keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{40}$/.test(k))||new Set(keys).size!==keys.length)return fail('交易選擇不正確');
  const credit=b.clearV03Credit===true;
  if(credit&&code!=='V03')return fail('此乘車金憑證僅適用 V03');
  if(!keys.length&&!credit)return fail('請選擇修復項目');
  const expected=b.expected;
  if(!expected||![expected.points,expected.rideCredit,expected.totalRides].every(numeric))return fail('缺少有效的掃描基準');
  // Always re-read the reports; never trust client-provided ride details.
  const scan=await reconcileMembers(['2026-10','2026-11']);
  const a=scan.accounts.find(x=>x.code===code);
  if(!a||a.incomplete)return fail('會員不存在或帳本查詢不完整',409);
  const chosen=a.rows.filter(r=>keys.includes(r.key));
  if(chosen.length!==keys.length||chosen.some(r=>!r.repairable))return fail('候選已變更、已入帳或屬於正式同步期間，請重新掃描',409);
  chosen.sort((x,y)=>x.date.localeCompare(y.date)||x.row-y.row);
  const mref=adminDb.collection('members').doc(code);
  const cref=adminDb.collection('rideCreditTransactions');
  const pref=adminDb.collection('pointTransactions');
  const reg=adminDb.collection('sheetMemberRides');
  const evidence=[{id:'winnie_manual_use_V03_20261103',date:'2026-11-03',amount:180},{id:'winnie_manual_use_V03_20261105',date:'2026-11-05',amount:60}];
  const result=await adminDb.runTransaction(async tx=>{
   const [m,points,registries,credits]=await Promise.all([
    tx.get(mref),tx.get(pref.where('memberCode','==',code).limit(351)),tx.get(reg.where('memberCode','==',code).limit(351)),
    tx.get(cref.where('memberCode','==',code).limit(351))]);
   if(!m.exists||points.size>350||registries.size>350||credits.size>350)throw new Error('查詢不完整，拒絕修復');
   const md=m.data()!;
   if(String(md.status??'active')!=='active'||norm(md.memberCode??code)!==code)throw new Error('會員狀態或編號不符');
   const old={points:md.points,rideCredit:md.rideCredit,totalRides:md.totalRides};
   if(!Object.values(old).every(numeric)||old.points>=10||old.points!==expected.points||old.rideCredit!==expected.rideCredit||old.totalRides!==expected.totalRides)throw new Error('會員資料已變更或點數不在0–9，請重新核對');
   if(Number(md.pendingCreditRecovery??0)!==0||md.needsManualReview===true)throw new Error('會員有待回收乘車金或人工審核，請先處理');
   const oldAuto=Number(md.autoRewardEarned??0);if(!numeric(oldAuto))throw new Error('歷史獎勵欄位不正確');
   // Block even reversed/same-day records; row number alone is not identity.
   for(const r of chosen){
    if(points.docs.some(d=>String(d.data().rideDate??'')===r.date)||registries.docs.some(d=>String(d.data().rideDate??'')===r.date && (norm(d.data().orderContent)===norm(r.order)||Number(d.data().sheetRow)===r.row)))throw new Error(`${r.date} 有既有紀錄，請人工逐筆核對`);
   }
   if(credit){
    if(old.rideCredit!==240)throw new Error('V03 原有乘車金不再是240元，請重新核對');
    const prior=credits.docs.filter(d=>{
      const v=d.data();const str=[v.rideDate,v.reason,v.type].map(x=>String(x??'')).join(' ');
      return evidence.some(e=>d.id===e.id)|| (Number(v.amount)<0&&(/2026-11-0[35]|11[/-]0?[35]|11月[35]日/.test(str)||[60,180,240].includes(-Number(v.amount))));
    });
    if(prior.length)throw new Error('存在可能相關的乘車金扣除紀錄，禁止重複更正，請先核對乘車金帳本');
   }
   let p:number=old.points,c:number=old.rideCredit,n:number=old.totalRides,auto=oldAuto;
   const now=FieldValue.serverTimestamp();
   if(credit){for(const e of evidence){const before=c;c-=e.amount;tx.create(cref.doc(e.id),{transactionId:e.id,memberCode:code,memberName:md.name??'',amount:-e.amount,type:'use',status:'active',reason:`LINE 人工對帳已折抵；${e.date}；不再次折抵後結。${reason}`,source:'admin_dashboard',rideDate:e.date,previousBalance:before,newBalance:c,actorUid:admin.uid,createdAt:now});}}
   for(const r of chosen){
    const stableRideId=r.key,transactionId='sheet_'+stableRideId; p++;n++;let reward=0;if(p===10){p=0;reward=60;c+=reward;auto+=reward;}
    const common={stableRideId,memberCode:code,spreadsheetId:r.spreadsheetId,sheetId:r.sheetId,sheetName:r.sheet,blockName:'',sheetRow:r.row,rideDate:r.date,orderContent:r.order,plate:r.plate,status:'active',createdAt:now,updatedAt:now};
    tx.create(pref.doc(transactionId),{...common,transactionId,memberName:md.name??'',type:'earn',points:1,rewardAmount:reward,source:'google_sheets_report',reason:`歷史人工核准補登；${reason}`,historicalRepair:true,actorUid:admin.uid});
    tx.create(reg.doc(stableRideId),{...common,pointTransactionId:transactionId,lastSeenRunId:'manual_repair_v2',lastSeenAt:now,missingCount:0,missingSince:null,reversedAt:null,reversedReason:'',historicalRepair:true});
    if(reward){const id='reward_'+transactionId;tx.create(cref.doc(id),{...common,transactionId:id,sourcePointTransactionId:transactionId,memberName:md.name??'',amount:reward,type:'reward',reason:'歷史補點集滿10點兌換60元',source:'google_sheets_report'});}
   }
   const after={points:p,rideCredit:c,totalRides:n};
   tx.update(mref,{...after,autoRewardEarned:auto,updatedAt:now});
   tx.create(adminDb.collection('memberReconciliationRepairs').doc(),{memberCode:code,keys,clearV03Credit:credit,previous:old,next:after,reason,actorUid:admin.uid,createdAt:now});
   return {before:old,after,added:chosen.length,creditUsed:credit?240:0};
  });
  return NextResponse.json({success:true,...result,lineSent:false});
 }catch(e){console.error('會員修復失敗',e);return fail(e instanceof Error?e.message:'修復失敗',409);}
}
