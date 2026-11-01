import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardApiResponse = {
  success: boolean;
  data?: unknown;
  message?: string;
};

type ArchiveRequestBody = {
  month?: string;
  force?: boolean;
};

type RolloverResult = {
  success?: boolean;
  month?: string;
  nextMonth?: string;

  // Apps Script 實際回傳欄位
  liveSpreadsheetId?: string;
  liveSpreadsheetName?: string;
  archiveSpreadsheetId?: string;
  archiveSpreadsheetName?: string;
  archiveUrl?: string;
  verified?: boolean;
  verification?: unknown;
  sourceFingerprint?: unknown;
  archiveFingerprint?: unknown;
  clearResult?: unknown;
  finalSync?: unknown;
  message?: string;

  [key: string]: unknown;
};

type AppsScriptResponse = {
  success: boolean;
  data?: RolloverResult;
  message?: string;
  [key: string]: unknown;
};

function getTaiwanMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";

  return `${year}-${month}`;
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getNextMonth(month: string): string {
  const [yearText, monthText] = month.split("-");

  let year = Number(yearText);
  let monthNumber = Number(monthText) + 1;

  if (monthNumber > 12) {
    monthNumber = 1;
    year += 1;
  }

  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function getAppsScriptUrl(): string {
  const apiUrl = process.env.GOOGLE_SHEETS_API_URL;

  if (!apiUrl) {
    throw new Error("尚未設定 GOOGLE_SHEETS_API_URL");
  }

  return apiUrl;
}

async function getCurrentDashboardData(): Promise<unknown> {
  const url = new URL(getAppsScriptUrl());

  // 避免 Apps Script / CDN 快取
  url.searchParams.set("_live", String(Date.now()));

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    headers: {
      Accept: "application/json",
    },
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(
      "[archive-month] 讀取 Apps Script Dashboard 失敗：",
      response.status,
      responseText
    );

    throw new Error(`Google Apps Script API 回傳錯誤：${response.status}`);
  }

  let result: DashboardApiResponse;

  try {
    result = JSON.parse(responseText) as DashboardApiResponse;
  } catch (error) {
    console.error(
      "[archive-month] Apps Script Dashboard 回傳不是 JSON：",
      responseText,
      error
    );

    throw new Error("Google Apps Script 回傳格式不是 JSON");
  }

  if (!result.success || result.data === undefined || result.data === null) {
    throw new Error(result.message || "Google 試算表 API 沒有回傳有效資料");
  }

  return result.data;
}

/**
 * 呼叫 Apps Script 真正的月底換月功能。
 *
 * Apps Script 第 11 版實際支援的 action：
 * archiveAndOpenNextMonth
 *
 * Apps Script 自己負責：
 * 1. 最後一次會員 / 後結同步
 * 2. 取得原始工作表指紋
 * 3. 尋找已存在且內容一致的封存副本
 * 4. 沒有才建立新副本
 * 5. 驗證副本
 * 6. 驗證成功後才清理原工作表
 * 7. 保留公式 / 格式 / 下拉選單
 * 8. 原 Spreadsheet ID 不變
 * 9. 原工作表改成下個月份
 */
async function runArchiveAndOpenNextMonth(
  month: string
): Promise<RolloverResult> {
  const apiUrl = getAppsScriptUrl();

  const response = await fetch(apiUrl, {
    method: "POST",
    cache: "no-store",
    redirect: "follow",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      Accept: "application/json",
    },
    body: JSON.stringify({
      action: "archiveAndOpenNextMonth",
      month,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(
      "[archive-month] Apps Script 換月 HTTP 失敗：",
      response.status,
      responseText
    );

    throw new Error(`Apps Script 換月 API 回傳錯誤：${response.status}`);
  }

  let result: AppsScriptResponse;

  try {
    result = JSON.parse(responseText) as AppsScriptResponse;
  } catch (error) {
    console.error(
      "[archive-month] Apps Script 換月回傳不是 JSON：",
      responseText,
      error
    );

    throw new Error("Apps Script 換月 API 回傳格式不是 JSON");
  }

  if (!result.success) {
    throw new Error(result.message || "Google Sheet 封存換月失敗");
  }

  if (!result.data || typeof result.data !== "object") {
    throw new Error("Apps Script 沒有回傳封存換月結果");
  }

  return result.data;
}

export async function POST(request: NextRequest) {
  try {
    let body: ArchiveRequestBody = {};

    try {
      const text = await request.text();

      if (text.trim()) {
        body = JSON.parse(text) as ArchiveRequestBody;
      }
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "POST 資料格式錯誤",
        },
        { status: 400 }
      );
    }

    const requestedMonth =
      typeof body.month === "string" ? body.month.trim() : "";

    // 前端有傳月份時一定以它為準。
    // 例如現在 2026-10-01，但仍可正確封存 2026-09。
    const month = requestedMonth || getTaiwanMonth();
    const force = body.force === true;

    if (!isValidMonth(month)) {
      return NextResponse.json(
        {
          success: false,
          message: "月份格式錯誤，正確格式例如：2026-09",
        },
        { status: 400 }
      );
    }

    const nextMonth = getNextMonth(month);

    const archiveRef = adminDb
      .collection("reportArchives")
      .doc(month);

    const existingSnapshot = await archiveRef.get();

    const existingData = existingSnapshot.exists
      ? existingSnapshot.data()
      : undefined;

    /**
     * 如果已經正式封存，而且前端沒有要求 force，
     * 就不重跑。
     *
     * 這次 9 月因為舊 Firebase 曾標記 archived，
     * 前端會傳 force:true，因此可以進入真正換月流程。
     */
    if (
      existingSnapshot.exists &&
      existingData?.archived === true &&
      !force
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "ALREADY_ARCHIVED",
          month,
          message: `${month} 已經完成封存，如需重新封存請使用 force`,
        },
        { status: 409 }
      );
    }

    /**
     * 先讀清除前 Dashboard。
     *
     * 注意：
     * 現在已經 10 月，因此 Dashboard 的 month analytics
     * 可能是 10 月 $0。
     *
     * 這份只保留作輔助快照。
     * 真正完整的 9 月歷史來源是 Google Sheet 封存副本。
     */
    const dashboardData = await getCurrentDashboardData();

    const startedAt = new Date();

    await archiveRef.set(
      {
        month,
        nextMonth,
        status: "processing",
        archived: false,
        rolloverStartedAt: startedAt,
        updatedAt: startedAt,
        data: dashboardData,
        source: "google-sheets-rollover",
        version: 4,
      },
      { merge: true }
    );

    let rollover: RolloverResult;

    try {
      /**
       * 真正呼叫 Apps Script。
       *
       * 很重要：
       * Apps Script 會自己先找已存在的完整封存副本。
       * 如果內容指紋一致就沿用，不會一直製造重複副本。
       */
      rollover = await runArchiveAndOpenNextMonth(month);
    } catch (error) {
      await archiveRef.set(
        {
          status: "failed",
          archived: false,
          rolloverFailedAt: new Date(),
          updatedAt: new Date(),
          error:
            error instanceof Error
              ? error.message
              : "Google Sheet 換月失敗",
        },
        { merge: true }
      );

      throw error;
    }

    /**
     * Apps Script 真正回傳：
     *
     * archiveSpreadsheetId
     * archiveSpreadsheetName
     * archiveUrl
     * liveSpreadsheetId
     * liveSpreadsheetName
     * verified
     */
    const archiveSpreadsheetId =
      typeof rollover.archiveSpreadsheetId === "string"
        ? rollover.archiveSpreadsheetId.trim()
        : "";

    const archiveSpreadsheetName =
      typeof rollover.archiveSpreadsheetName === "string"
        ? rollover.archiveSpreadsheetName.trim()
        : "";

    const archiveUrl =
      typeof rollover.archiveUrl === "string"
        ? rollover.archiveUrl.trim()
        : "";

    const liveSpreadsheetId =
      typeof rollover.liveSpreadsheetId === "string"
        ? rollover.liveSpreadsheetId.trim()
        : "";

    const liveSpreadsheetName =
      typeof rollover.liveSpreadsheetName === "string"
        ? rollover.liveSpreadsheetName.trim()
        : "";

    /**
     * 安全檢查 1：
     * Apps Script 必須明確回傳 verified:true。
     */
    if (rollover.verified !== true) {
      await archiveRef.set(
        {
          status: "verification_failed",
          archived: false,
          updatedAt: new Date(),
          rolloverResult: rollover,
        },
        { merge: true }
      );

      throw new Error(
        "Google Sheet 封存副本尚未通過驗證，因此不標記為正式封存"
      );
    }

    /**
     * 安全檢查 2：
     * 必須有封存 Spreadsheet ID。
     */
    if (!archiveSpreadsheetId) {
      await archiveRef.set(
        {
          status: "verification_failed",
          archived: false,
          updatedAt: new Date(),
          rolloverResult: rollover,
        },
        { merge: true }
      );

      throw new Error("Apps Script 沒有回傳封存 Spreadsheet ID");
    }

    /**
     * 安全檢查 3：
     * Apps Script 回傳月份若存在，必須跟我們要求的一致。
     */
    if (
      typeof rollover.month === "string" &&
      rollover.month &&
      rollover.month !== month
    ) {
      await archiveRef.set(
        {
          status: "month_mismatch",
          archived: false,
          updatedAt: new Date(),
          rolloverResult: rollover,
        },
        { merge: true }
      );

      throw new Error(
        `Apps Script 回傳月份不一致：要求 ${month}，實際 ${rollover.month}`
      );
    }

    const completedAt = new Date();

    /**
     * 正式封存。
     *
     * archiveSpreadsheetId / archiveUrl
     * 才是完整歷史報表的真正來源。
     */
    const archiveData = {
      month,
      nextMonth,

      status: "archived",
      archived: true,

      // 輔助 Dashboard 快照
      data: dashboardData,

      // 完整歷史 Google Sheet
      archiveSpreadsheetId,
      archiveSpreadsheetName,
      archiveSpreadsheetUrl: archiveUrl,
      archiveUrl,

      // 相容舊欄位
      archiveFileName: archiveSpreadsheetName,
      reportUrl: archiveUrl,

      // 原工作報表
      workingSpreadsheetId: liveSpreadsheetId,
      workingSpreadsheetName: liveSpreadsheetName,
      workingFileName: liveSpreadsheetName,

      // Apps Script 已經做完嚴格驗證
      verified: true,

      // Apps Script 詳細結果
      verification: rollover.verification ?? null,
      sourceFingerprint: rollover.sourceFingerprint ?? null,
      archiveFingerprint: rollover.archiveFingerprint ?? null,
      clearResult: rollover.clearResult ?? null,
      finalSync: rollover.finalSync ?? null,
      rolloverResult: rollover,

      createdAt: existingData?.createdAt ?? completedAt,
      archivedAt: completedAt,
      updatedAt: completedAt,

      source: "google-sheets-archive-copy",
      version: 4,
    };

    await archiveRef.set(archiveData, {
      merge: true,
    });

    /**
     * Firestore 再驗證一次。
     */
    const verifySnapshot = await archiveRef.get();

    if (!verifySnapshot.exists) {
      throw new Error("Firestore 寫入後驗證失敗");
    }

    const verifyData = verifySnapshot.data();

    if (
      verifyData?.archived !== true ||
      verifyData?.status !== "archived" ||
      verifyData?.archiveSpreadsheetId !== archiveSpreadsheetId
    ) {
      throw new Error("Firestore 封存狀態驗證失敗");
    }

    return NextResponse.json(
      {
        success: true,
        month,
        nextMonth,
        archived: true,
        verified: true,

        archiveSpreadsheetId,
        archiveSpreadsheetName,
        archiveSpreadsheetUrl: archiveUrl,

        workingSpreadsheetId: liveSpreadsheetId,
        workingSpreadsheetName: liveSpreadsheetName,

        message:
          `${month} 報表已完整封存，` +
          `原工作報表已開啟 ${nextMonth}`,

        rollover,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "[archive-month] 月份報表封存失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "月份報表封存失敗",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}