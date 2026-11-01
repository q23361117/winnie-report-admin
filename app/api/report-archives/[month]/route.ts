import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    month: string;
  }>;
};

type ArchiveDocument = {
  month?: string;
  archived?: boolean;
  verified?: boolean;

  archiveSpreadsheetId?: string;
  archiveSpreadsheetName?: string;

  reportUrl?: string;
  archiveUrl?: string;

  historicalSource?: string;
  source?: string;

  status?: string;

  [key: string]: unknown;
};

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * 取得 Apps Script Web App URL
 *
 * 使用目前專案既有的：
 * GOOGLE_SHEETS_API_URL
 */
function getAppsScriptUrl(): string {
  const url = process.env.GOOGLE_SHEETS_API_URL?.trim();

  if (!url) {
    throw new Error(
      "缺少 GOOGLE_SHEETS_API_URL 環境變數"
    );
  }

  return url;
}

/**
 * 從「指定的封存 Google Sheet」讀取歷史報表。
 *
 * 注意：
 * 這裡不是讀目前 10 月工作報表。
 *
 * 會把：
 * - action=dashboard
 * - month=2026-09
 * - spreadsheetId=9月封存副本ID
 *
 * 傳給 Apps Script。
 *
 * Apps Script 下一步必須支援 spreadsheetId，
 * 才能真正讀取指定的歷史封存副本。
 */
async function fetchArchivedDashboard(params: {
  month: string;
  spreadsheetId: string;
}) {
  const { month, spreadsheetId } = params;

  const appsScriptUrl = getAppsScriptUrl();

  const url = new URL(appsScriptUrl);

  url.searchParams.set(
    "action",
    "dashboard"
  );

  url.searchParams.set(
    "month",
    month
  );

  url.searchParams.set(
    "spreadsheetId",
    spreadsheetId
  );

  /**
   * 避免 Google / Vercel 快取。
   */
  url.searchParams.set(
    "_live",
    Date.now().toString()
  );

  console.log(
    "[report-archives/[month]] 讀取封存 Google Sheet：",
    {
      month,
      spreadsheetId,
    }
  );

  const response = await fetch(
    url.toString(),
    {
      method: "GET",

      cache: "no-store",

      headers: {
        Accept: "application/json",
      },
    }
  );

  const rawText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Apps Script 讀取封存報表失敗：HTTP ${response.status} ${rawText.slice(
        0,
        500
      )}`
    );
  }

  let result: unknown;

  try {
    result = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Apps Script 回傳不是有效 JSON：${rawText.slice(
        0,
        500
      )}`
    );
  }

  if (
    !result ||
    typeof result !== "object"
  ) {
    throw new Error(
      "Apps Script 沒有回傳有效的歷史報表資料"
    );
  }

  const resultObject =
    result as Record<string, unknown>;

  /**
   * 如果 Apps Script 明確回傳：
   * success: false
   *
   * 就直接視為失敗。
   */
  if (
    resultObject.success === false
  ) {
    const message =
      typeof resultObject.message ===
      "string"
        ? resultObject.message
        : "Apps Script 讀取歷史報表失敗";

    throw new Error(message);
  }

  return resultObject;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { month } =
      await context.params;

    /**
     * ------------------------------------------------
     * 1. 驗證月份
     * ------------------------------------------------
     */
    if (!isValidMonth(month)) {
      return NextResponse.json(
        {
          success: false,

          message:
            "月份格式錯誤，正確格式為 YYYY-MM",
        },
        {
          status: 400,
        }
      );
    }

    /**
     * ------------------------------------------------
     * 2. 找 Firestore 封存登記
     * ------------------------------------------------
     */
    const docRef = adminDb
      .collection("reportArchives")
      .doc(month);

    const snapshot =
      await docRef.get();

    if (!snapshot.exists) {
      return NextResponse.json(
        {
          success: false,

          month,

          message:
            `找不到 ${month} 的歷史報表`,
        },
        {
          status: 404,
        }
      );
    }

    const archiveData =
      snapshot.data() as
        | ArchiveDocument
        | undefined;

    if (!archiveData) {
      return NextResponse.json(
        {
          success: false,

          month,

          message:
            `${month} 歷史報表沒有資料`,
        },
        {
          status: 404,
        }
      );
    }

    /**
     * ------------------------------------------------
     * 3. 取得正式封存 Google Sheet ID
     * ------------------------------------------------
     */
    const archiveSpreadsheetId =
      typeof archiveData.archiveSpreadsheetId ===
      "string"
        ? archiveData.archiveSpreadsheetId.trim()
        : "";

    /**
     * 舊封存資料如果沒有 archiveSpreadsheetId，
     * 不再拿舊 Dashboard 快照假裝是完整歷史報表。
     */
    if (!archiveSpreadsheetId) {
      return NextResponse.json(
        {
          success: false,

          month,

          archived:
            archiveData.archived === true,

          message:
            `${month} 尚未登記正式 Google Sheet 封存來源`,

          archive: {
            archiveSpreadsheetId: null,

            archiveSpreadsheetName:
              archiveData.archiveSpreadsheetName ??
              "",

            reportUrl:
              archiveData.reportUrl ??
              archiveData.archiveUrl ??
              "",
          },
        },
        {
          status: 409,

          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
        }
      );
    }

    /**
     * ------------------------------------------------
     * 4. 從真正的 Google Sheet 封存副本讀資料
     * ------------------------------------------------
     */
    let historicalData:
      | Record<string, unknown>
      | null = null;

    let historicalReadError:
      | string
      | null = null;

    try {
      historicalData =
        await fetchArchivedDashboard({
          month,
          spreadsheetId:
            archiveSpreadsheetId,
        });
    } catch (error) {
      historicalReadError =
        error instanceof Error
          ? error.message
          : "讀取封存 Google Sheet 失敗";

      console.error(
        "[report-archives/[month]] 讀取封存 Google Sheet 失敗：",
        {
          month,
          archiveSpreadsheetId,
          error,
        }
      );
    }

    /**
     * ------------------------------------------------
     * 5. 封存 Google Sheet 讀取失敗
     * ------------------------------------------------
     *
     * 非常重要：
     *
     * 不 fallback 到以前 Firestore 裡：
     *
     * totalFare = 0
     * rideCount = 0
     *
     * 的舊快照。
     *
     * 否則前台會再次把錯誤資料顯示成正式歷史資料。
     */
    if (!historicalData) {
      return NextResponse.json(
        {
          success: false,

          month,

          archived:
            archiveData.archived === true,

          verified:
            archiveData.verified === true,

          source:
            "google-sheet-archive",

          archiveSpreadsheetId,

          archiveSpreadsheetName:
            archiveData.archiveSpreadsheetName ??
            "",

          reportUrl:
            archiveData.reportUrl ??
            archiveData.archiveUrl ??
            "",

          message:
            historicalReadError ??
            "目前無法讀取歷史 Google Sheet 封存副本",

          /**
           * 明確告訴前端：
           * 不可以使用 Firestore 舊快照。
           */
          staleSnapshotIgnored: true,
        },
        {
          status: 502,

          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
        }
      );
    }

    /**
     * ------------------------------------------------
     * 6. 成功
     * ------------------------------------------------
     *
     * 保留原本 API 使用方式：
     *
     * {
     *   success: true,
     *   month,
     *   archived: true,
     *   data: ...
     * }
     *
     * 所以 analytics/page.tsx
     * 不需要因為這一步大改資料結構。
     */
    return NextResponse.json(
      {
        success: true,

        month,

        archived: true,

        verified:
          archiveData.verified === true,

        /**
         * 明確標示這次資料來源。
         */
        source:
          "google-sheet-archive",

        historicalSource:
          "google-sheet-archive",

        archiveSpreadsheetId,

        archiveSpreadsheetName:
          archiveData.archiveSpreadsheetName ??
          "",

        reportUrl:
          archiveData.reportUrl ??
          archiveData.archiveUrl ??
          "",

        /**
         * 真正的歷史報表資料。
         */
        data: historicalData,
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "[report-archives/[month]] 讀取歷史月份報表失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "讀取歷史月份報表失敗",
      },
      {
        status: 500,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}