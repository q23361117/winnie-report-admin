import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Registration = {
  month?: unknown;
  spreadsheetId?: unknown;
  spreadsheetName?: unknown;
  confirmationHash?: unknown;
};

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const validMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const validId = (v: string) => /^[a-zA-Z0-9_-]{20,200}$/.test(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const reply = (payload: unknown, status = 200) =>
  NextResponse.json(payload, { status, headers: NO_CACHE });

function authorized(request: NextRequest): boolean {
  // 伺服器私密環境變數；不要使用 NEXT_PUBLIC_ 前綴。
  const expected = process.env.ARCHIVE_REGISTRATION_TOKEN?.trim() ?? "";
  const actual = request.headers.get("x-archive-registration-token")?.trim() ?? "";
  if (expected.length < 32 || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 只向已設定的 Apps Script 執行唯讀查詢；不觸發帳務同步。 */
async function verifyArchiveSheet(id: string, month: string) {
  const base = process.env.GOOGLE_SHEETS_API_URL;
  if (!base) throw new Error("尚未設定 GOOGLE_SHEETS_API_URL");
  const url = new URL(base);
  if (url.protocol !== "https:") throw new Error("Apps Script URL 必須使用 HTTPS");
  url.searchParams.set("action", "dashboard");
  url.searchParams.set("spreadsheetId", id);
  url.searchParams.set("month", month);
  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`歷史副本查詢 HTTP ${response.status}`);
  const raw = (await response.json()) as Record<string, unknown>;
  if (raw.success !== true) throw new Error("Apps Script 無法讀取歷史副本");
  const data = raw.data as Record<string, unknown> | undefined;
  const returnedId = str(data?.spreadsheetId || raw.spreadsheetId);
  if (returnedId !== id) throw new Error("Apps Script 回傳的試算表 ID 不符合");
  if (str(data?.reportMonth) !== month) throw new Error("歷史統計月份不符合");
  const analytics = data?.analytics as Record<string, unknown> | undefined;
  const monthAnalytics = analytics?.month as Record<string, unknown> | undefined;
  if (!monthAnalytics || typeof monthAnalytics.rideCount !== "number") {
    throw new Error("歷史副本缺少月份統計欄位");
  }
  if (monthAnalytics.rideCount <= 0) {
    throw new Error("歷史副本本月有效單量為零；請先人工核對，不允許自動登記");
  }
  return { rideCount: monthAnalytics.rideCount, totalFare: monthAnalytics.totalFare ?? null };
}

/** 歷史月份清單：手動呼叫時才讀取，僅回傳必要欄位。 */
export async function GET() {
  // 保留既有前端無附加標頭的 GET 呼叫；僅輸出必要的公開月別資訊。
  try {
    const snapshot = await adminDb.collection("reportArchives")
      .orderBy("month", "desc").limit(60).get();
    const months = snapshot.docs.filter((doc) => doc.id !== "init")
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          month: str(d.month) || doc.id,
          status: str(d.status),
          archived: d.archived === true,
          verified: d.verified === true,
          archiveSpreadsheetName: str(d.archiveSpreadsheetName),
          reportUrl: str(d.reportUrl),
        };
      });
    return reply({ success: true, months });
  } catch (error) {
    console.error("讀取歷史報表清單失敗", error);
    return reply({ success: false, message: "歷史報表讀取失敗" }, 500);
  }
}

/** 僅登記已經人工預覽通過的 2026-10 Google Sheet，完全不清空及不入帳。 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return reply({ success: false, message: "未授權" }, 401);
  try {
    let body: Registration;
    try { body = await request.json() as Registration; }
    catch { return reply({ success: false, message: "JSON 格式錯誤" }, 400); }

    const month = str(body.month);
    const id = str(body.spreadsheetId);
    const name = str(body.spreadsheetName);
    const hash = str(body.confirmationHash).toLowerCase();
    if (!validMonth(month) || !validId(id)) return reply({ success: false, message: "月份或 Spreadsheet ID 格式錯誤" }, 400);

    // 僅允許已人工核對的月份、歷史副本及指紋；防止誤登其他報表。
    const approvedMonth = process.env.ARCHIVE_APPROVED_MONTH?.trim() ?? "";
    const approvedId = process.env.ARCHIVE_APPROVED_SPREADSHEET_ID?.trim() ?? "";
    const approvedHash = process.env.ARCHIVE_APPROVED_CONTENT_HASH?.trim().toLowerCase() ?? "";
    if (!approvedMonth || !approvedId || !/^[a-f0-9]{64}$/.test(approvedHash)) {
      return reply({ success: false, message: "尚未在伺服器設定人工預覽通過的封存憑證" }, 503);
    }
    if (month !== approvedMonth || id !== approvedId || hash !== approvedHash) {
      return reply({ success: false, message: "提交的歷史副本與已核准封存資訊不符" }, 403);
    }

    const confirmed = await verifyArchiveSheet(id, month);
    const ref = adminDb.collection("reportArchives").doc(month);
    const doc = await ref.get();
    const existing = doc.exists ? doc.data() : undefined;
    if (existing?.archived === true) {
      return reply({ success: false, message: "此月份已完成登記，請先檢查既有紀錄，不允許覆蓋" }, 409);
    }

    const now = new Date();
    const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    // 不使用傳入 URL 避免存入外部連結，也不改寫舊 data 快照。
    await ref.set({
      month, status: "archived", archived: true,
      verified: true, verificationMethod: "manual-preview-hash-and-readonly-dashboard",
      // 註：下列 hash 為管理員已核對的預覽指紋；API 沒有重新計算 Google Sheet 指紋。
      verifiedContentHash: hash,
      archiveSpreadsheetId: id,
      archiveSpreadsheetName: name || `歷史封存 ${month}`,
      reportUrl: url, archiveUrl: url,
      historicalSource: "google-sheet-archive", source: "google-sheet-archive",
      rolloverPerformed: false, registrationType: "existing-verified-archive",
      verifiedRideCount: confirmed.rideCount, verifiedTotalFare: confirmed.totalFare,
      createdAt: existing?.createdAt ?? now, archivedAt: now, registeredAt: now,
      updatedAt: now, version: 5,
    }, { merge: true });
    return reply({ success: true, month, archived: true, spreadsheetId: id,
      message: "10 月歷史副本已登記。此操作沒有清空工作表，亦沒有處理後結或集點。" });
  } catch (error) {
    console.error("歷史副本補登失敗", error);
    return reply({ success: false, message: error instanceof Error ? error.message : "歷史副本補登失敗" }, 500);
  }
}
