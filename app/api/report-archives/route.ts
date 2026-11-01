import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterArchiveBody = {
  month?: string;
  spreadsheetId?: string;
  spreadsheetName?: string;
  reportUrl?: string;
};

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * 讀取所有已登記的歷史月份
 */
export async function GET() {
  try {
    const snapshot = await adminDb
      .collection("reportArchives")
      .orderBy("month", "desc")
      .get();

    const months = snapshot.docs
      .filter((doc) => doc.id !== "init")
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

    return NextResponse.json(
      {
        success: true,
        months,
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
      "[report-archives] 讀取歷史報表失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "讀取歷史報表失敗",
      },
      {
        status: 500,
      }
    );
  }
}

/**
 * 純補登記歷史 Google Sheet。
 *
 * 重要：
 * 這支 API 不會：
 * - 執行換月
 * - 清除工作報表
 * - 修改 10 月 Google Sheet
 * - 建立新的 Google Sheet 副本
 * - 重新計算後結
 * - 重新計算會員點數
 *
 * 只負責把「已經存在、已經完成驗證的封存副本」
 * 登記到 Firestore。
 */
export async function POST(request: NextRequest) {
  try {
    let body: RegisterArchiveBody;

    try {
      body = (await request.json()) as RegisterArchiveBody;
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
      typeof body.month === "string"
        ? body.month.trim()
        : "";

    const spreadsheetId =
      typeof body.spreadsheetId === "string"
        ? body.spreadsheetId.trim()
        : "";

    const spreadsheetName =
      typeof body.spreadsheetName === "string"
        ? body.spreadsheetName.trim()
        : "";

    const reportUrl =
      typeof body.reportUrl === "string"
        ? body.reportUrl.trim()
        : "";

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

    if (!spreadsheetId) {
      return NextResponse.json(
        {
          success: false,
          message: "缺少 spreadsheetId",
        },
        {
          status: 400,
        }
      );
    }

    const finalReportUrl =
      reportUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    const archiveRef = adminDb
      .collection("reportArchives")
      .doc(month);

    const existingSnapshot =
      await archiveRef.get();

    const existingData =
      existingSnapshot.exists
        ? existingSnapshot.data()
        : undefined;

    const now = new Date();

    /**
     * 注意：
     *
     * 這裡不覆蓋原本的 data。
     *
     * 因為舊的 data 可能是之前 Dashboard 快照，
     * 即使它不完整，也先保留。
     *
     * 真正完整的歷史來源改成 archiveSpreadsheetId。
     */
    await archiveRef.set(
      {
        month,

        status: "archived",

        archived: true,

        verified: true,

        archiveSpreadsheetId: spreadsheetId,

        archiveSpreadsheetName:
          spreadsheetName ||
          existingData?.archiveSpreadsheetName ||
          "",

        reportUrl: finalReportUrl,

        archiveUrl: finalReportUrl,

        /**
         * 明確指定：
         * 歷史月份真正資料來源是 Google Sheet 封存副本。
         */
        historicalSource: "google-sheet-archive",

        source: "google-sheet-archive",

        /**
         * 這代表這次只是補登記，
         * 沒有再次執行換月。
         */
        rolloverPerformed: false,

        registrationType: "existing-verified-archive",

        createdAt:
          existingData?.createdAt ?? now,

        archivedAt:
          existingData?.archivedAt ?? now,

        registeredAt: now,

        updatedAt: now,

        version: 3,
      },
      {
        merge: true,
      }
    );

    /**
     * 寫完再驗證 Firestore。
     */
    const verifySnapshot =
      await archiveRef.get();

    if (!verifySnapshot.exists) {
      throw new Error(
        "Firestore 封存登記後驗證失敗"
      );
    }

    const verifyData =
      verifySnapshot.data();

    if (
      verifyData?.archiveSpreadsheetId !==
      spreadsheetId
    ) {
      throw new Error(
        "Firestore 封存 Spreadsheet ID 驗證失敗"
      );
    }

    if (verifyData?.archived !== true) {
      throw new Error(
        "Firestore archived 狀態驗證失敗"
      );
    }

    return NextResponse.json(
      {
        success: true,

        month,

        archived: true,

        verified: true,

        spreadsheetId,

        reportUrl: finalReportUrl,

        message:
          `${month} 已補登記為正式 Google Sheet 歷史封存；未再次執行換月。`,
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
      "[report-archives] 補登記歷史報表失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "補登記歷史報表失敗",
      },
      {
        status: 500,
      }
    );
  }
}