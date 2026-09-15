import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    month: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { month } = await context.params;

    // 月份格式必須是 YYYY-MM
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json(
        {
          success: false,
          message: "月份格式錯誤，正確格式為 YYYY-MM",
        },
        {
          status: 400,
        }
      );
    }

    const docRef = adminDb
      .collection("reportArchives")
      .doc(month);

    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return NextResponse.json(
        {
          success: false,
          month,
          message: `找不到 ${month} 的歷史報表`,
        },
        {
          status: 404,
        }
      );
    }

    const data = snapshot.data();

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          month,
          message: `${month} 歷史報表沒有資料`,
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        month,
        archived: data.archived === true,
        data,
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
    console.error("讀取歷史月份報表失敗：", error);

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
      }
    );
  }
}