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

function getTaiwanMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year =
    parts.find((part) => part.type === "year")?.value ?? "";

  const month =
    parts.find((part) => part.type === "month")?.value ?? "";

  return `${year}-${month}`;
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

async function getCurrentDashboardData(): Promise<unknown> {
  const apiUrl = process.env.GOOGLE_SHEETS_API_URL;

  if (!apiUrl) {
    throw new Error("尚未設定 GOOGLE_SHEETS_API_URL");
  }

  const url = new URL(apiUrl);

  // 避免讀到 Apps Script / CDN 快取
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
      "月結讀取 Google Apps Script 失敗：",
      response.status,
      responseText
    );

    throw new Error(
      `Google Apps Script API 回傳錯誤：${response.status}`
    );
  }

  let result: DashboardApiResponse;

  try {
    result = JSON.parse(
      responseText
    ) as DashboardApiResponse;
  } catch (error) {
    console.error(
      "月結時 Apps Script 回傳不是 JSON：",
      responseText,
      error
    );

    throw new Error(
      "Google Apps Script 回傳格式不是 JSON"
    );
  }

  if (
    !result.success ||
    result.data === undefined ||
    result.data === null
  ) {
    throw new Error(
      result.message ||
        "Google 試算表 API 沒有回傳有效資料"
    );
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
        {
          status: 400,
        }
      );
    }

    const month =
      typeof body.month === "string" && body.month.trim()
        ? body.month.trim()
        : getTaiwanMonth();

    const force = body.force === true;

    if (!isValidMonth(month)) {
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

    /*
     * 1. 先讀目前 Google Sheet 的完整 Dashboard 資料。
     *
     * 很重要：
     * 一定要先成功取得資料，才允許寫入封存。
     * 這樣可以避免 Apps Script 掛掉時，
     * 反而建立一份空的歷史報表。
     */
    const dashboardData =
      await getCurrentDashboardData();

    /*
     * 2. 找到這個月份的 Firestore 文件。
     */
    const archiveRef = adminDb
      .collection("reportArchives")
      .doc(month);

    const existingSnapshot =
      await archiveRef.get();

    const existingData =
      existingSnapshot.exists
        ? existingSnapshot.data()
        : undefined;

    /*
     * 3. 已經正式封存過的月份，預設禁止直接覆蓋。
     *
     * 如果未來真的需要重新封存，
     * 可以 POST：
     *
     * {
     *   "month": "2026-09",
     *   "force": true
     * }
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
          message:
            `${month} 已經完成封存，如需重新封存請使用 force`,
        },
        {
          status: 409,
        }
      );
    }

    const now = new Date();

    /*
     * 4. 完整保存 Apps Script 回傳的 data。
     *
     * 現階段不拆欄位、不重新計算。
     *
     * 這樣最安全：
     * Google Sheet 現在後台看到什麼，
     * 月結當下就把那份資料完整凍結下來。
     */
    const archiveData = {
      month,

      status: "archived",

      archived: true,

      /*
       * 完整歷史快照。
       *
       * 之後歷史報表頁可以直接讀這份。
       */
      data: dashboardData,

      /*
       * Google Sheet 副本功能下一階段接上。
       */
      reportUrl:
        typeof existingData?.reportUrl === "string"
          ? existingData.reportUrl
          : "",

      /*
       * 保留原本建立時間。
       */
      createdAt:
        existingData?.createdAt ?? now,

      /*
       * 每次真正封存的時間。
       */
      archivedAt: now,

      updatedAt: now,

      /*
       * 標記資料來源，方便未來維護。
       */
      source: "google-sheets-dashboard",

      version: 2,
    };

    /*
     * 5. 寫入 Firestore。
     *
     * merge:true：
     * 不會把之後新增的其他欄位整份洗掉。
     */
    await archiveRef.set(
      archiveData,
      {
        merge: true,
      }
    );

    /*
     * 6. 再讀一次，確認 Firestore 確實存在。
     */
    const verifySnapshot =
      await archiveRef.get();

    if (!verifySnapshot.exists) {
      throw new Error(
        "Firestore 寫入後驗證失敗"
      );
    }

    return NextResponse.json(
      {
        success: true,

        month,

        archived: true,

        message:
          `${month} 報表資料封存成功`,

        /*
         * 測試階段回傳資料，
         * 方便我們確認 Apps Script 實際資料結構。
         *
         * 等功能全部完成後，
         * 如果資料量太大再把這個移除。
         */
        data: dashboardData,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "月份報表封存失敗：",
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
      }
    );
  }
}