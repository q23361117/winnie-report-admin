import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * =========================================================
 * 司機月費 Google Sheet 串接 API
 * =========================================================
 *
 * 功能：
 * 1. 串接「🐻司機月費繳款」Google Apps Script
 * 2. 取得可用月份
 * 3. 指定月份讀取司機月費資料
 * 4. 統一整理資料格式給前端使用
 *
 * 使用方式：
 *
 * /api/drivers/sheets
 *
 * /api/drivers/sheets?month=8
 *
 * /api/drivers/sheets?month=9
 *
 * =========================================================
 */

const DRIVER_FEE_APPS_SCRIPT_URL =
  process.env.DRIVER_FEE_APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbyVyk3BsVbtDVVU_41tbaGXpSObWLLzFzJK5iJTc-Iv-sLiypd7FSQwcPJHVhLzX4k9SQ/exec";

/**
 * Apps Script 原始司機資料
 *
 * 因為 Apps Script 回傳的是中文欄位，
 * 所以這裡保留中文欄位名稱。
 */
type RawDriver = {
  sourceRow?: number;

  月份?: number | string;

  name?: string;
  lineName?: string;

  車牌?: string;
  plate?: string;

  入會費?: number | string;
  joinFee?: number | string;

  月費?: number | string;
  monthlyFee?: number | string;

  總計?: number | string;
  total?: number | string;

  預期金額?: number | string;
  expectedAmount?: number | string;

  繳款方式?: string;
  paymentMethod?: string;

  已支付?: string | boolean;
  paid?: string | boolean;

  paymentStatus?: string;

  paidRaw?: string;

  備註?: string;
  note?: string;

  [key: string]: unknown;
};

type AvailableMonth = {
  month?: number;
  月份?: number;

  label?: string;

  sheetName?: string;
};

type AppsScriptResponse = {
  success?: boolean;

  成功?: boolean | string;

  spreadsheetId?: string;

  spreadsheetName?: string;

  試算表名稱?: string;

  month?: number;

  月份?: number;

  monthLabel?: string;

  月份標籤?: string;

  sheetName?: string;

  工作表?: string;

  availableMonths?: AvailableMonth[];

  可用月份?: AvailableMonth[];

  drivers?: RawDriver[];

  司機?: RawDriver[];

  message?: string;

  訊息?: string;

  error?: string;

  [key: string]: unknown;
};

type NormalizedDriver = {
  sourceRow: number | null;

  month: number;

  name: string;

  lineName: string;

  plate: string;

  joinFee: number;

  monthlyFee: number;

  total: number;

  expectedAmount: number;

  paymentMethod: string;

  paid: boolean;

  paymentStatus:
    | "paid"
    | "unpaid"
    | "unknown";

  paidRaw: string;

  note: string;

  raw: RawDriver;
};

/**
 * 將任何值安全轉成字串
 */
function toText(value: unknown): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

/**
 * 將金額轉成 number
 *
 * 支援：
 * 1500
 * "1500"
 * "$1,500"
 * "1,500"
 * "NT$ 1,500"
 */
function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : 0;
  }

  const text = toText(value);

  if (!text) {
    return 0;
  }

  const cleaned = text.replace(
    /[^0-9.-]/g,
    ""
  );

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : 0;
}

/**
 * 判斷是否已繳款
 */
function toPaidBoolean(
  value: unknown
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const text = toText(value)
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!text) {
    return false;
  }

  const paidValues = [
    "true",
    "1",
    "yes",
    "y",
    "是",
    "已繳",
    "已繳費",
    "已付款",
    "已支付",
    "完成",
    "paid",
  ];

  return paidValues.includes(text);
}

/**
 * 驗證月份
 */
function normalizeMonth(
  value: string | null
): number | null {
  if (!value) {
    return null;
  }

  const month = Number(value);

  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  return month;
}

/**
 * 台灣目前月份
 */
function getTaiwanMonth(): number {
  const monthText =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      month: "numeric",
    }).format(new Date());

  const month = Number(monthText);

  if (
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  ) {
    return month;
  }

  return new Date().getMonth() + 1;
}

/**
 * 判斷 Apps Script success
 *
 * 你的 Apps Script 目前可能回：
 *
 * success: true
 *
 * 或：
 *
 * "成功": "是"
 */
function isAppsScriptSuccess(
  data: AppsScriptResponse
): boolean {
  if (data.success === true) {
    return true;
  }

  if (data.成功 === true) {
    return true;
  }

  const successText =
    toText(data.成功);

  return [
    "是",
    "true",
    "成功",
    "ok",
  ].includes(
    successText.toLowerCase()
  );
}

/**
 * 取得 Apps Script 回傳的司機陣列
 */
function getRawDrivers(
  data: AppsScriptResponse
): RawDriver[] {
  if (Array.isArray(data.drivers)) {
    return data.drivers;
  }

  if (Array.isArray(data.司機)) {
    return data.司機;
  }

  return [];
}

/**
 * 取得可用月份
 */
function getAvailableMonths(
  data: AppsScriptResponse
): AvailableMonth[] {
  if (
    Array.isArray(
      data.availableMonths
    )
  ) {
    return data.availableMonths;
  }

  if (
    Array.isArray(data.可用月份)
  ) {
    return data.可用月份;
  }

  return [];
}

/**
 * 整理單一司機資料
 */
function normalizeDriver(
  raw: RawDriver,
  fallbackMonth: number
): NormalizedDriver {
  const sourceRowNumber =
    toNumber(raw.sourceRow);

  const rawMonth =
    toNumber(
      raw.month ??
        raw.月份 ??
        fallbackMonth
    );

  const month =
    rawMonth >= 1 &&
    rawMonth <= 12
      ? rawMonth
      : fallbackMonth;

  const name =
    toText(raw.name) ||
    toText(raw.lineName);

  const lineName =
    toText(raw.lineName) ||
    name;

  const plate =
    toText(raw.plate) ||
    toText(raw.車牌);

  const joinFee =
    toNumber(
      raw.joinFee ??
        raw.入會費
    );

  const monthlyFee =
    toNumber(
      raw.monthlyFee ??
        raw.月費
    );

  const totalFromApi =
    toNumber(
      raw.total ??
        raw.總計
    );

  const calculatedTotal =
    joinFee + monthlyFee;

  const total =
    totalFromApi > 0
      ? totalFromApi
      : calculatedTotal;

  const expectedFromApi =
    toNumber(
      raw.expectedAmount ??
        raw.預期金額
    );

  const expectedAmount =
    expectedFromApi > 0
      ? expectedFromApi
      : total;

  const paymentMethod =
    toText(
      raw.paymentMethod ??
        raw.繳款方式
    );

  const paidRaw =
    toText(
      raw.paidRaw ??
        raw.已支付 ??
        raw.paid
    );

  let paid =
    toPaidBoolean(
      raw.paid ??
        raw.已支付
    );

  const rawPaymentStatus =
    toText(raw.paymentStatus)
      .toLowerCase();

  if (
    [
      "paid",
      "已繳",
      "已繳費",
      "已付款",
      "已支付",
    ].includes(rawPaymentStatus)
  ) {
    paid = true;
  }

  let paymentStatus:
    | "paid"
    | "unpaid"
    | "unknown";

  if (paid) {
    paymentStatus = "paid";
  } else if (
    expectedAmount > 0 ||
    paidRaw
  ) {
    paymentStatus = "unpaid";
  } else {
    paymentStatus = "unknown";
  }

  const note =
    toText(raw.note) ||
    toText(raw.備註);

  return {
    sourceRow:
      sourceRowNumber > 0
        ? sourceRowNumber
        : null,

    month,

    name,

    lineName,

    plate,

    joinFee,

    monthlyFee,

    total,

    expectedAmount,

    paymentMethod,

    paid,

    paymentStatus,

    paidRaw,

    note,

    raw,
  };
}

/**
 * 清除真正的空白列
 */
function isRealDriver(
  driver: NormalizedDriver
): boolean {
  return Boolean(
    driver.name ||
      driver.plate
  );
}

/**
 * 計算統計
 */
function buildSummary(
  drivers: NormalizedDriver[]
) {
  const totalDrivers =
    drivers.length;

  const paidDrivers =
    drivers.filter(
      (driver) => driver.paid
    );

  const unpaidDrivers =
    drivers.filter(
      (driver) =>
        !driver.paid &&
        driver.expectedAmount > 0
    );

  const noFeeDrivers =
    drivers.filter(
      (driver) =>
        driver.expectedAmount <= 0
    );

  const joinFeeTotal =
    drivers.reduce(
      (sum, driver) =>
        sum + driver.joinFee,
      0
    );

  const monthlyFeeTotal =
    drivers.reduce(
      (sum, driver) =>
        sum + driver.monthlyFee,
      0
    );

  const expectedAmount =
    drivers.reduce(
      (sum, driver) =>
        sum +
        driver.expectedAmount,
      0
    );

  const paidAmount =
    paidDrivers.reduce(
      (sum, driver) =>
        sum +
        driver.expectedAmount,
      0
    );

  const unpaidAmount =
    unpaidDrivers.reduce(
      (sum, driver) =>
        sum +
        driver.expectedAmount,
      0
    );

  const paymentRate =
    totalDrivers > 0
      ? Number(
          (
            (paidDrivers.length /
              totalDrivers) *
            100
          ).toFixed(1)
        )
      : 0;

  return {
    totalDrivers,

    paidCount:
      paidDrivers.length,

    unpaidCount:
      unpaidDrivers.length,

    noFeeCount:
      noFeeDrivers.length,

    joinFeeTotal,

    monthlyFeeTotal,

    expectedAmount,

    paidAmount,

    unpaidAmount,

    paymentRate,
  };
}

/**
 * GET
 *
 * /api/drivers/sheets
 *
 * /api/drivers/sheets?month=8
 */
export async function GET(
  request: NextRequest
) {
  try {
    const searchParams =
      request.nextUrl.searchParams;

    const requestedMonthText =
      searchParams.get("month");

    const requestedMonth =
      normalizeMonth(
        requestedMonthText
      );

    /**
     * 有傳 month 但格式錯誤
     */
    if (
      requestedMonthText &&
      requestedMonth === null
    ) {
      return NextResponse.json(
        {
          success: false,

          message:
            "月份格式錯誤，month 必須是 1～12，例如 ?month=8",
        },
        {
          status: 400,
        }
      );
    }

    const targetMonth =
      requestedMonth ??
      getTaiwanMonth();

    /**
     * 組 Apps Script URL
     */
    const apiUrl = new URL(
      DRIVER_FEE_APPS_SCRIPT_URL
    );

    /**
     * 傳月份給 Apps Script
     *
     * Apps Script 如果已支援 month，
     * 就會直接切換工作表。
     */
    apiUrl.searchParams.set(
      "month",
      String(targetMonth)
    );

    /**
     * 避免快取
     */
    apiUrl.searchParams.set(
      "_t",
      String(Date.now())
    );

    console.log(
      `[Driver Sheets] 正在讀取 ${targetMonth} 月資料`
    );

    /**
     * 呼叫 Apps Script
     */
    const response = await fetch(
      apiUrl.toString(),
      {
        method: "GET",

        cache: "no-store",

        redirect: "follow",

        headers: {
          Accept:
            "application/json,text/plain,*/*",
        },
      }
    );

    const responseText =
      await response.text();

    /**
     * HTTP 錯誤
     */
    if (!response.ok) {
      console.error(
        "[Driver Sheets] Apps Script HTTP Error:",
        response.status,
        responseText
      );

      return NextResponse.json(
        {
          success: false,

          message:
            `Google Apps Script 讀取失敗：HTTP ${response.status}`,
        },
        {
          status: 502,
        }
      );
    }

    /**
     * JSON 解析
     */
    let result: AppsScriptResponse;

    try {
      result = JSON.parse(
        responseText
      ) as AppsScriptResponse;
    } catch (error) {
      console.error(
        "[Driver Sheets] Apps Script JSON 解析失敗：",
        responseText,
        error
      );

      return NextResponse.json(
        {
          success: false,

          message:
            "Google Apps Script 回傳的不是有效 JSON",

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

    /**
     * Apps Script 本身回傳失敗
     */
    if (
      !isAppsScriptSuccess(result)
    ) {
      console.error(
        "[Driver Sheets] Apps Script 回傳失敗：",
        result
      );

      return NextResponse.json(
        {
          success: false,

          message:
            result.message ||
            result.訊息 ||
            result.error ||
            "Google Apps Script 回傳失敗",

          source: result,
        },
        {
          status: 502,
        }
      );
    }

    /**
     * 原始司機資料
     */
    const rawDrivers =
      getRawDrivers(result);

    /**
     * 整理資料
     */
    const drivers =
      rawDrivers
        .map((driver) =>
          normalizeDriver(
            driver,
            targetMonth
          )
        )
        .filter(isRealDriver);

    /**
     * 可用月份
     */
    const availableMonths =
      getAvailableMonths(result)
        .map((item) => {
          const month =
            toNumber(
              item.month ??
                item.月份
            );

          return {
            month,

            label:
              toText(
                item.label
              ) ||
              `${month}月`,

            sheetName:
              toText(
                item.sheetName
              ) ||
              `${month}月司機繳費`,
          };
        })
        .filter(
          (item) =>
            item.month >= 1 &&
            item.month <= 12
        );

    /**
     * 統計
     */
    const summary =
      buildSummary(drivers);

    /**
     * Apps Script 實際回傳月份
     */
    const actualMonth =
      toNumber(
        result.month ??
          result.月份 ??
          targetMonth
      ) || targetMonth;

    const sheetName =
      toText(
        result.sheetName ??
          result.工作表
      ) ||
      `${actualMonth}月司機繳費`;

    const spreadsheetName =
      toText(
        result.spreadsheetName ??
          result.試算表名稱
      );

    /**
     * 成功
     */
    return NextResponse.json(
      {
        success: true,

        source:
          "google-driver-fee-sheet",

        spreadsheet: {
          id:
            toText(
              result.spreadsheetId
            ),

          name:
            spreadsheetName,

          sheetName,
        },

        month: actualMonth,

        monthLabel:
          toText(
            result.monthLabel ??
              result.月份標籤
          ) ||
          `${actualMonth}月`,

        availableMonths,

        drivers,

        summary,

        fetchedAt:
          new Date().toISOString(),
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",

          Pragma: "no-cache",

          Expires: "0",
        },
      }
    );
  } catch (error) {
    console.error(
      "[Driver Sheets] API 發生錯誤：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "讀取司機月費試算表失敗",
      },
      {
        status: 500,
      }
    );
  }
}