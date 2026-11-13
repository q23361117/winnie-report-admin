import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-session";
import { reconcilePostpaid, type ReportMonth, SCAN_MONTHS } from "@/lib/postpaid-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "禁止跨站請求" }, { status: 403 });
  }
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: "請重新登入管理員帳號" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { months?: unknown };
    if (!Array.isArray(body.months) || body.months.length < 1 ||
      body.months.length > 2 || body.months.some((m) => !SCAN_MONTHS.includes(m as ReportMonth)) ||
      new Set(body.months).size !== body.months.length) {
      return NextResponse.json({ error: "核對月份必須是 2026-10、2026-11 之一或兩者" }, { status: 400 });
    }
    const result = await reconcilePostpaid(body.months as ReportMonth[]);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("後結對帳失敗", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "後結對帳失敗" }, { status: 500 });
  }
}
