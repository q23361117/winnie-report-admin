import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-session';
import { reconcileMembers, SCAN_MONTHS, type ReportMonth } from '@/lib/member-reconciliation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:NextRequest){
  if(request.headers.get('origin')!==request.nextUrl.origin) return NextResponse.json({error:'禁止跨站請求'},{status:403});
  if(!(await getAdminSession())) return NextResponse.json({error:'請重新登入管理員'},{status:401});
  try {
    const {months}=await request.json() as {months?:unknown};
    if(!Array.isArray(months)||months.length<1||months.length>2||new Set(months).size!==months.length||months.some(m=>!SCAN_MONTHS.includes(m as ReportMonth))) return NextResponse.json({error:'請選擇10月或11月'},{status:400});
    return NextResponse.json({success:true,...await reconcileMembers(months as ReportMonth[])},{headers:{'Cache-Control':'no-store'}});
  }catch(e){console.error('會員對帳失敗',e);return NextResponse.json({error:e instanceof Error?e.message:'對帳失敗'},{status:500});}
}
