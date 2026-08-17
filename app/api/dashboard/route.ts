import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardApiResponse = {
  success: boolean;
  data?: unknown;
  message?: string;
};

export async function GET() {
  try {
    const apiUrl = process.env.GOOGLE_SHEETS_API_URL;

    if (!apiUrl) {
      return NextResponse.json(
        {
          success: false,
          message: "尚未設定 GOOGLE_SHEETS_API_URL",
        },
        {
          status: 500,
        }
      );
    }

    const url = new URL(apiUrl);

    // 避免 Apps Script / CDN 回傳舊快取
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
        "Google Apps Script API 錯誤：",
        response.status,
        responseText
      );

      return NextResponse.json(
        {
          success: false,
          message: `Google Apps Script API 回傳錯誤：${response.status}`,
        },
        {
          status: 502,
        }
      );
    }

    let result: DashboardApiResponse;

    try {
      result = JSON.parse(
        responseText
      ) as DashboardApiResponse;
    } catch (error) {
      console.error(
        "Google Apps Script 回傳不是 JSON：",
        responseText,
        error
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Google Apps Script 回傳格式不是 JSON",
        },
        {
          status: 502,
        }
      );
    }

    if (
      !result.success ||
      !result.data
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            result.message ||
            "Google 試算表 API 沒有回傳有效資料",
        },
        {
          status: 502,
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: result.data,
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
      "Dashboard API 代理失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Dashboard API 代理失敗",
      },
      {
        status: 500,
      }
    );
  }
}