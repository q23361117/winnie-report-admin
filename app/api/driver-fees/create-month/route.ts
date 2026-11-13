import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================================================
 * 型別
 * =======================================================*/

type CreateMonthRequestBody = {
  month?: string;
};

type AppsScriptMonth = {
  month?: number;
  label?: string;
  sheetName?: string;
};

type AppsScriptDriver = {
  sourceRow?: number;
  month?: number;
  name?: string;
  lineName?: string;
  plate?: string;
  joinFee?: number;
  monthlyFee?: number;
  total?: number;
  expectedAmount?: number;
  paymentMethod?: string;
  paid?: boolean;
  paymentStatus?: string;
  paidRaw?: string;
  note?: string;
};

type AppsScriptCreateMonthResponse = {
  success?: boolean;

  created?: boolean;

  alreadyExists?: boolean;

  month?: number;

  monthLabel?: string;

  sheetName?: string;

  copiedFromMonth?: number;

  copiedFromSheet?: string;

  driverCount?: number;

  drivers?: AppsScriptDriver[];

  summary?: unknown;

  availableMonths?: AppsScriptMonth[];

  message?: string;

  updatedAt?: string;

  [key: string]: unknown;
};

/* =========================================================
 * 基本工具
 * =======================================================*/

function cleanString(
  value: unknown
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

/**
 * 驗證 YYYY-MM
 *
 * 例如：
 * 2026-09
 */
function isValidMonth(
  value: string
): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    value
  );
}

/**
 * 台灣目前月份
 *
 * 例如：
 * 2026-09
 */
function getTaiwanMonth(): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Taipei",

        year:
          "numeric",

        month:
          "2-digit",
      }
    ).formatToParts(
      new Date()
    );

  const year =
    parts.find(
      (part) =>
        part.type === "year"
    )?.value ?? "";

  const month =
    parts.find(
      (part) =>
        part.type === "month"
    )?.value ?? "";

  return `${year}-${month}`;
}

/* =========================================================
 * 取得司機月費 Apps Script URL
 * =======================================================*/

function getAppsScriptUrl(): string {
  /**
   * 優先使用司機月費專用環境變數。
   *
   * .env.local：
   *
   * DRIVER_FEE_SHEETS_API_URL=https://script.google.com/macros/s/xxxxx/exec
   */
  const url =
    process.env
      .DRIVER_FEE_SHEETS_API_URL;

  if (url) {
    return url;
  }

  /**
   * 相容之前可能使用的名稱。
   */
  const fallback =
    process.env
      .DRIVER_FEE_APPS_SCRIPT_URL;

  if (fallback) {
    return fallback;
  }

  throw new Error(
    "尚未設定 DRIVER_FEE_SHEETS_API_URL"
  );
}

/* =========================================================
 * POST
 *
 * POST /api/driver-fees/create-month
 *
 * body：
 *
 * {
 *   "month": "2026-09"
 * }
 *
 * =======================================================*/

export async function POST(
  request: NextRequest
) {
  try {
    /* =====================================================
     * 1. 解析前端資料
     * ===================================================*/

    let body:
      CreateMonthRequestBody = {};

    try {
      const text =
        await request.text();

      if (
        text.trim()
      ) {
        body =
          JSON.parse(
            text
          ) as CreateMonthRequestBody;
      }
    } catch {
      return NextResponse.json(
        {
          success: false,

          message:
            "POST 資料格式錯誤",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
     * 2. 取得月份
     * ===================================================*/

    const month =
      cleanString(
        body.month
      ) ||
      getTaiwanMonth();

    if (
      !isValidMonth(month)
    ) {
      return NextResponse.json(
        {
          success: false,

          message:
            "月份格式錯誤，正確格式例如：2026-09",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
     * 3. 取得 Apps Script URL
     * ===================================================*/

    const apiUrl =
      getAppsScriptUrl();

    const url =
      new URL(apiUrl);

    /**
     * 避免 Apps Script / CDN 快取。
     */
    url.searchParams.set(
      "_live",
      String(Date.now())
    );

    /* =====================================================
     * 4. 呼叫 Apps Script
     *
     * Apps Script 收到：
     *
     * {
     *   action: "createMonth",
     *   month: "2026-09"
     * }
     *
     * 就會建立：
     *
     * 9月司機繳費
     * ===================================================*/

    const response =
      await fetch(
        url.toString(),
        {
          method: "POST",

          cache: "no-store",

          redirect: "follow",

          headers: {
            Accept:
              "application/json",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              action:
                "createMonth",

              month,
            }),
        }
      );

    const responseText =
      await response.text();

    /* =====================================================
     * 5. HTTP 錯誤
     * ===================================================*/

    if (!response.ok) {
      console.error(
        "[Create Driver Fee Month] Apps Script HTTP Error:",
        response.status,
        responseText
      );

      return NextResponse.json(
        {
          success: false,

          message:
            `Google Apps Script 回傳錯誤：HTTP ${response.status}`,
        },
        {
          status: 502,
        }
      );
    }

    /* =====================================================
     * 6. JSON 解析
     * ===================================================*/

    let result:
      AppsScriptCreateMonthResponse;

    try {
      result =
        JSON.parse(
          responseText
        ) as AppsScriptCreateMonthResponse;
    } catch (error) {
      console.error(
        "[Create Driver Fee Month] Apps Script 回傳不是 JSON：",
        responseText,
        error
      );

      return NextResponse.json(
        {
          success: false,

          message:
            "Google Apps Script 回傳格式不是 JSON",

          preview:
            responseText.slice(
              0,
              500
            ),
        },
        {
          status: 502,
        }
      );
    }

    /* =====================================================
     * 7. Apps Script 本身執行失敗
     * ===================================================*/

    if (
      result.success !== true
    ) {
      console.error(
        "[Create Driver Fee Month] Apps Script 建立失敗：",
        result
      );

      return NextResponse.json(
        {
          success: false,

          month,

          message:
            cleanString(
              result.message
            ) ||
            "建立月份報表失敗",

          source:
            result,
        },
        {
          status: 502,
        }
      );
    }

    /* =====================================================
     * 8. 整理回傳資料
     * ===================================================*/

    const created =
      result.created === true;

    const alreadyExists =
      result.alreadyExists === true;

    const sheetName =
      cleanString(
        result.sheetName
      );

    const copiedFromSheet =
      cleanString(
        result.copiedFromSheet
      );

    const driverCount =
      typeof result.driverCount ===
        "number"
        ? result.driverCount
        : Array.isArray(
            result.drivers
          )
          ? result.drivers.length
          : 0;

    /* =====================================================
     * 9. 成功
     * ===================================================*/

    return NextResponse.json(
      {
        success: true,

        month,

        created,

        alreadyExists,

        sheetName,

        copiedFromMonth:
          result.copiedFromMonth ??
          null,

        copiedFromSheet,

        driverCount,

        availableMonths:
          Array.isArray(
            result.availableMonths
          )
            ? result.availableMonths
            : [],

        /**
         * 保留 Apps Script 回傳的司機資料，
         * 下一階段可以直接拿來同步 Firebase。
         */
        drivers:
          Array.isArray(
            result.drivers
          )
            ? result.drivers
            : [],

        summary:
          result.summary ??
          null,

        updatedAt:
          result.updatedAt ??
          null,

        message:
          cleanString(
            result.message
          ) ||
          (
            alreadyExists
              ? `${sheetName || month} 已經存在`
              : `${sheetName || month} 建立成功`
          ),
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",

          Pragma:
            "no-cache",

          Expires:
            "0",
        },
      }
    );

  } catch (error) {
    console.error(
      "[Create Driver Fee Month] 建立月份報表失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "建立月份報表失敗",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
 * GET
 *
 * 瀏覽器直接開：
 *
 * /api/driver-fees/create-month
 *
 * 只確認 API 已載入，
 * 不會真的建立工作表。
 * =======================================================*/

export async function GET() {
  return NextResponse.json(
    {
      success: true,

      ready: true,

      message:
        "司機月費建立月份 API 已就緒",

      features: {
        createGoogleSheetMonth:
          true,

        preventDuplicateMonth:
          true,

        copyPreviousMonth:
          true,

        preserveSheetFormatting:
          true,

        resetPaymentData:
          true,
      },

      usage: {
        method:
          "POST",

        endpoint:
          "/api/driver-fees/create-month",

        example: {
          month:
            "2026-09",
        },
      },
    },
    {
      status: 200,

      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    }
  );
}