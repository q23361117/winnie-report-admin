import {
  NextRequest,
  NextResponse,
} from "next/server";

import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================================================
 * 型別
 * =======================================================*/

type DriverStatus =
  | "active"
  | "resting"
  | "inactive";

type SheetDriver = {
  sourceRow?: number;

  month?: number;

  name?: string;

  lineName?: string;

  plate?: string;

  joinFee?: number | string;

  monthlyFee?: number | string;

  total?: number | string;

  expectedAmount?: number | string;

  paymentMethod?: string;

  paid?: boolean | string;

  paidRaw?: string;

  paymentStatus?: string;

  note?: string;
};

type SheetApiResponse = {
  success?: boolean;

  成功?: boolean;

  message?: string;

  spreadsheetId?: string;

  spreadsheetName?: string;

  month?: number;

  月份?: number;

  monthLabel?: string;

  sheetName?: string;

  工作表?: string;

  drivers?: SheetDriver[];

  司機?: SheetDriver[];
};

type SyncRequestBody = {
  month?: string;

  overwrite?: boolean;
};

type FirebaseDriver = {
  id: string;

  name: string;

  plate: string;

  plan: string;

  status: DriverStatus;

  monthlyFee: number;

  joinedAt: unknown;

  note: string;
};

/* =========================================================
 * 基本工具
 * =======================================================*/

function cleanString(
  value: unknown
): string {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function parseMoney(
  value: unknown,
  defaultValue = 0
): number {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return defaultValue;
  }

  if (
    typeof value === "number"
  ) {
    if (
      !Number.isFinite(value)
    ) {
      return defaultValue;
    }

    return Math.max(
      0,
      Math.round(value)
    );
  }

  const text =
    String(value)
      .replace(/,/g, "")
      .replace(/\$/g, "")
      .replace(/NT\$/gi, "")
      .trim();

  if (!text) {
    return defaultValue;
  }

  const parsed =
    Number(text);

  if (
    !Number.isFinite(parsed)
  ) {
    return defaultValue;
  }

  return Math.max(
    0,
    Math.round(parsed)
  );
}

function isValidMonth(
  value: string
): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    value
  );
}

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

function getMonthNumber(
  month: string
): number {
  return Number(
    month.split("-")[1]
  );
}

function normalizeStatus(
  value: unknown
): DriverStatus {
  if (
    value === "resting"
  ) {
    return "resting";
  }

  if (
    value === "inactive"
  ) {
    return "inactive";
  }

  return "active";
}

/* =========================================================
 * 名稱 / 車牌比對
 * =======================================================*/

function normalizeName(
  value: unknown
): string {
  return cleanString(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizePlate(
  value: unknown
): string {
  return cleanString(value)
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toLowerCase();
}

/* =========================================================
 * 判斷繳費狀態
 * =======================================================*/

function parsePaid(
  driver: SheetDriver,
  totalAmount: number
): {
  paid: boolean;
  paidAmount: number;
} {
  if (
    typeof driver.paid ===
    "boolean"
  ) {
    return {
      paid:
        driver.paid,

      paidAmount:
        driver.paid
          ? totalAmount
          : 0,
    };
  }

  const raw =
    [
      driver.paid,
      driver.paidRaw,
      driver.paymentStatus,
    ]
      .map(
        (value) =>
          cleanString(value)
      )
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  if (!raw) {
    return {
      paid: false,
      paidAmount: 0,
    };
  }

  const unpaidKeywords = [
    "未繳",
    "未繳交",
    "未付款",
    "未支付",
    "尚未",
    "否",
    "false",
    "no",
  ];

  if (
    unpaidKeywords.some(
      (keyword) =>
        raw.includes(keyword)
    )
  ) {
    return {
      paid: false,
      paidAmount: 0,
    };
  }

  const paidKeywords = [
    "已繳",
    "已繳交",
    "已付款",
    "已支付",
    "完成",
    "是",
    "true",
    "yes",
  ];

  const paid =
    paidKeywords.some(
      (keyword) =>
        raw.includes(keyword)
    );

  return {
    paid,

    paidAmount:
      paid
        ? totalAmount
        : 0,
  };
}

/* =========================================================
 * 讀取 Apps Script
 * =======================================================*/

async function fetchSheetDrivers(
  month: string
): Promise<{
  sheetName: string;
  drivers: SheetDriver[];
}> {
  const apiUrl =
    process.env
      .DRIVER_FEE_SHEETS_API_URL ||
    process.env
      .GOOGLE_SHEETS_API_URL;

  if (!apiUrl) {
    throw new Error(
      "尚未設定 DRIVER_FEE_SHEETS_API_URL"
    );
  }

  const monthNumber =
    getMonthNumber(month);

  const url =
    new URL(apiUrl);

  url.searchParams.set(
    "month",
    String(monthNumber)
  );

  url.searchParams.set(
    "_live",
    String(Date.now())
  );

  const response =
    await fetch(
      url.toString(),
      {
        method: "GET",

        cache: "no-store",

        redirect: "follow",

        headers: {
          Accept:
            "application/json",
        },
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    console.error(
      "讀取司機月費 Apps Script 失敗：",
      response.status,
      responseText
    );

    throw new Error(
      `司機月費 Apps Script 回傳錯誤：${response.status}`
    );
  }

  let result:
    SheetApiResponse;

  try {
    result =
      JSON.parse(
        responseText
      ) as SheetApiResponse;
  } catch (error) {
    console.error(
      "司機月費 Apps Script 回傳不是 JSON：",
      responseText,
      error
    );

    throw new Error(
      "司機月費 Apps Script 回傳格式不是 JSON"
    );
  }

  const success =
    result.success === true ||
    result.成功 === true;

  if (!success) {
    throw new Error(
      result.message ||
        "司機月費試算表 API 讀取失敗"
    );
  }

  const drivers =
    Array.isArray(
      result.drivers
    )
      ? result.drivers
      : Array.isArray(
          result.司機
        )
        ? result.司機
        : [];

  const sheetName =
    cleanString(
      result.sheetName
    ) ||
    cleanString(
      result.工作表
    );

  return {
    sheetName,
    drivers,
  };
}

/* =========================================================
 * 讀 Firebase 司機主檔
 * =======================================================*/

async function getDrivers():
Promise<FirebaseDriver[]> {
  const snapshot =
    await adminDb
      .collection(
        "drivers"
      )
      .get();

  return snapshot.docs.map(
    (doc) => {
      const data =
        doc.data();

      return {
        id:
          doc.id,

        name:
          cleanString(
            data.name
          ),

        plate:
          cleanString(
            data.plate
          ),

        plan:
          cleanString(
            data.plan
          ),

        status:
          normalizeStatus(
            data.status
          ),

        monthlyFee:
          parseMoney(
            data.monthlyFee
          ),

        joinedAt:
          data.joinedAt ??
          null,

        note:
          cleanString(
            data.note
          ),
      };
    }
  );
}

/* =========================================================
 * 比對 Firebase 司機
 * =======================================================*/

function findMatchingDriver(
  sheetDriver: SheetDriver,
  firebaseDrivers: FirebaseDriver[]
):
FirebaseDriver | null {
  const sheetName =
    normalizeName(
      sheetDriver.name ||
        sheetDriver.lineName
    );

  const sheetPlate =
    normalizePlate(
      sheetDriver.plate
    );

  /*
   * 第一優先：
   * 名稱 + 車牌一致
   */
  if (
    sheetName &&
    sheetPlate
  ) {
    const exact =
      firebaseDrivers.find(
        (driver) =>
          normalizeName(
            driver.name
          ) ===
            sheetName &&
          normalizePlate(
            driver.plate
          ) ===
            sheetPlate
      );

    if (exact) {
      return exact;
    }
  }

  /*
   * 第二優先：
   * 車牌唯一一致
   */
  if (sheetPlate) {
    const samePlate =
      firebaseDrivers.filter(
        (driver) =>
          normalizePlate(
            driver.plate
          ) ===
          sheetPlate
      );

    if (
      samePlate.length === 1
    ) {
      return samePlate[0];
    }
  }

  /*
   * 第三優先：
   * 名稱唯一一致
   */
  if (sheetName) {
    const sameName =
      firebaseDrivers.filter(
        (driver) =>
          normalizeName(
            driver.name
          ) ===
          sheetName
      );

    if (
      sameName.length === 1
    ) {
      return sameName[0];
    }
  }

  return null;
}

/* =========================================================
 * 建立 Firebase 司機主檔
 *
 * 注意：
 * 只有找不到司機時才建立。
 *
 * 試算表沒有方案 / 跑車狀態歷史，
 * 因此新建主檔使用安全預設值：
 *
 * plan = ""
 * status = active
 *
 * 月費使用試算表該筆 monthlyFee。
 * =======================================================*/

async function createDriverFromSheet(
  sheetDriver: SheetDriver,
  month: string,
  sheetName: string
): Promise<FirebaseDriver> {
  const driverName =
    cleanString(
      sheetDriver.name ||
        sheetDriver.lineName
    );

  const plate =
    cleanString(
      sheetDriver.plate
    );

  const monthlyFee =
    parseMoney(
      sheetDriver.monthlyFee
    );

  const note =
    cleanString(
      sheetDriver.note
    );

  const now =
    new Date();

  const driverData = {
    name:
      driverName,

    lineName:
      driverName,

    plate,

    /*
     * 這裡不猜方案。
     * 後台可以再設定。
     */
    plan:
      "",

    status:
      "active" as DriverStatus,

    monthlyFee,

    /*
     * 不能從舊月費表可靠推斷
     * 真正加入日期，所以不亂填。
     */
    joinedAt:
      null,

    note,

    source:
      "driver-fee-google-sheet",

    importedFromSheet:
      true,

    importedFromMonth:
      month,

    importedFromSheetName:
      sheetName,

    createdAt:
      now,

    updatedAt:
      now,
  };

  const driverRef =
    await adminDb
      .collection(
        "drivers"
      )
      .add(
        driverData
      );

  return {
    id:
      driverRef.id,

    name:
      driverName,

    plate,

    plan:
      "",

    status:
      "active",

    monthlyFee,

    joinedAt:
      null,

    note,
  };
}

/* =========================================================
 * POST
 *
 * POST /api/driver-fees/sync-sheet
 *
 * body:
 *
 * {
 *   "month": "2026-08",
 *   "overwrite": false
 * }
 * =======================================================*/

export async function POST(
  request: NextRequest
) {
  try {
    let body:
      SyncRequestBody = {};

    try {
      const text =
        await request.text();

      if (
        text.trim()
      ) {
        body =
          JSON.parse(
            text
          ) as SyncRequestBody;
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

    const month =
      cleanString(
        body.month
      ) ||
      getTaiwanMonth();

    const overwrite =
      body.overwrite === true;

    if (
      !isValidMonth(month)
    ) {
      return NextResponse.json(
        {
          success: false,

          message:
            "月份格式錯誤，正確格式例如：2026-08",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
     * 1. 讀取試算表
     * ===================================================*/

    const {
      sheetName,
      drivers:
        sheetDrivers,
    } =
      await fetchSheetDrivers(
        month
      );

    if (
      sheetDrivers.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,

          month,

          sheetName,

          message:
            `${month} 試算表沒有找到司機資料`,
        },
        {
          status: 404,
        }
      );
    }

    /* =====================================================
     * 2. 讀 Firebase drivers
     * ===================================================*/

    const firebaseDrivers =
      await getDrivers();

    /* =====================================================
     * 統計
     * ===================================================*/

    const driverMastersCreated:
      Array<{
        driverId: string;
        name: string;
        plate: string;
      }> = [];

    const driverMastersMatched:
      Array<{
        driverId: string;
        name: string;
        plate: string;
      }> = [];

    const feeRecordsCreated:
      Array<{
        driverId: string;
        name: string;
        plate: string;
      }> = [];

    const feeRecordsUpdated:
      Array<{
        driverId: string;
        name: string;
        plate: string;
      }> = [];

    const skipped:
      Array<{
        name: string;
        plate: string;
        reason: string;
      }> = [];

    const errors:
      Array<{
        name: string;
        plate: string;
        reason: string;
      }> = [];

    /* =====================================================
     * 3. 一筆一筆同步
     * ===================================================*/

    for (
      const sheetDriver of
      sheetDrivers
    ) {
      const driverName =
        cleanString(
          sheetDriver.name ||
            sheetDriver.lineName
        );

      const plate =
        cleanString(
          sheetDriver.plate
        );

      /*
       * 空白列略過
       */
      if (!driverName) {
        skipped.push({
          name: "",
          plate,

          reason:
            "試算表司機名稱空白",
        });

        continue;
      }

      try {
        /* ===============================================
         * 3-1. 先找現有 Firebase 司機
         * =============================================*/

        let matchedDriver =
          findMatchingDriver(
            sheetDriver,
            firebaseDrivers
          );

        /* ===============================================
         * 3-2. 找不到 → 自動建立 drivers 主檔
         * =============================================*/

        if (!matchedDriver) {
          matchedDriver =
            await createDriverFromSheet(
              sheetDriver,
              month,
              sheetName
            );

          /*
           * 很重要：
           *
           * 新增後立刻加入記憶體陣列。
           * 同一次同步後面的資料，
           * 就能比對到剛新增的司機，
           * 避免同一輪重複建立。
           */
          firebaseDrivers.push(
            matchedDriver
          );

          driverMastersCreated.push({
            driverId:
              matchedDriver.id,

            name:
              matchedDriver.name,

            plate:
              matchedDriver.plate,
          });
        } else {
          driverMastersMatched.push({
            driverId:
              matchedDriver.id,

            name:
              matchedDriver.name,

            plate:
              matchedDriver.plate,
          });
        }

        /* ===============================================
         * 3-3. 計算當月金額
         * =============================================*/

        const monthlyFee =
          parseMoney(
            sheetDriver.monthlyFee
          );

        const joinFee =
          parseMoney(
            sheetDriver.joinFee
          );

        const totalAmount =
          monthlyFee +
          joinFee;

        const {
          paid,
          paidAmount,
        } =
          parsePaid(
            sheetDriver,
            totalAmount
          );

        const unpaidAmount =
          Math.max(
            0,
            totalAmount -
              paidAmount
          );

        const paymentMethod =
          cleanString(
            sheetDriver.paymentMethod
          );

        const note =
          cleanString(
            sheetDriver.note
          );

        /* ===============================================
         * 3-4. 每月每位司機固定一筆
         *
         * 例如：
         * 2026-08_xxxxxxxxx
         * =============================================*/

        const recordId =
          `${month}_${matchedDriver.id}`;

        const recordRef =
          adminDb
            .collection(
              "driverFeeRecords"
            )
            .doc(
              recordId
            );

        const oldSnapshot =
          await recordRef.get();

        const oldData =
          oldSnapshot.exists
            ? oldSnapshot.data()
            : undefined;

        /* ===============================================
         * 已存在本月紀錄
         *
         * overwrite:false
         * → 保護人工修改資料
         *
         * overwrite:true
         * → 強制依試算表更新
         * =============================================*/

        if (
          oldSnapshot.exists &&
          !overwrite
        ) {
          skipped.push({
            name:
              driverName,

            plate,

            reason:
              "Firebase 已有本月月費紀錄，未覆蓋",
          });

          continue;
        }

        const now =
          new Date();

        let paidAt:
          unknown =
          null;

        if (paid) {
          if (
            oldData?.paid === true &&
            oldData?.paidAt
          ) {
            paidAt =
              oldData.paidAt;
          } else {
            paidAt =
              now;
          }
        }

        /* ===============================================
         * 3-5. 寫入歷史月費紀錄
         *
         * 不會修改 drivers 的：
         * - status
         * - plan
         * - joinedAt
         *
         * 所以同步 8 月不會破壞 9 月現況。
         * =============================================*/

        const recordData = {
          month,

          driverId:
            matchedDriver.id,

          driverName,

          plate:
            plate ||
            matchedDriver.plate,

          plan:
            matchedDriver.plan,

          status:
            matchedDriver.status,

          monthlyFee,

          joinFee,

          totalAmount,

          expectedAmount:
            totalAmount,

          paidAmount,

          unpaidAmount,

          paid,

          paymentStatus:
            paid
              ? "paid"
              : "unpaid",

          paymentMethod,

          note,

          paidAt,

          source:
            "driver-fee-google-sheet",

          sourceSheet:
            sheetName,

          sourceRow:
            sheetDriver.sourceRow ??
            null,

          createdAt:
            oldData?.createdAt ??
            now,

          updatedAt:
            now,

          syncedAt:
            now,
        };

        await recordRef.set(
          recordData,
          {
            merge: true,
          }
        );

        if (
          oldSnapshot.exists
        ) {
          feeRecordsUpdated.push({
            driverId:
              matchedDriver.id,

            name:
              driverName,

            plate:
              plate ||
              matchedDriver.plate,
          });
        } else {
          feeRecordsCreated.push({
            driverId:
              matchedDriver.id,

            name:
              driverName,

            plate:
              plate ||
              matchedDriver.plate,
          });
        }
      } catch (error) {
        console.error(
          `同步司機失敗：${driverName}`,
          error
        );

        errors.push({
          name:
            driverName,

          plate,

          reason:
            error instanceof Error
              ? error.message
              : "同步失敗",
        });
      }
    }

    /* =====================================================
     * 4. 回傳結果
     * ===================================================*/

    return NextResponse.json(
      {
        success:
          errors.length === 0,

        month,

        sheetName,

        message:
          `試算表同步完成：` +
          `主檔新增 ${driverMastersCreated.length} 位、` +
          `主檔配對 ${driverMastersMatched.length} 位、` +
          `月費新增 ${feeRecordsCreated.length} 筆、` +
          `月費更新 ${feeRecordsUpdated.length} 筆、` +
          `略過 ${skipped.length} 筆、` +
          `失敗 ${errors.length} 筆`,

        summary: {
          sheetDrivers:
            sheetDrivers.length,

          /*
           * 同步結束後 Firebase 主檔數
           */
          firebaseDrivers:
            firebaseDrivers.length,

          driverMastersCreated:
            driverMastersCreated.length,

          driverMastersMatched:
            driverMastersMatched.length,

          feeRecordsCreated:
            feeRecordsCreated.length,

          feeRecordsUpdated:
            feeRecordsUpdated.length,

          skipped:
            skipped.length,

          errors:
            errors.length,
        },

        driverMastersCreated,

        driverMastersMatched,

        feeRecordsCreated,

        feeRecordsUpdated,

        skipped,

        errors,
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
      "司機月費試算表同步失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "司機月費試算表同步失敗",
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
 * 瀏覽器開：
 *
 * /api/driver-fees/sync-sheet
 *
 * 只確認 API 存在，
 * 不會真的同步。
 * =======================================================*/

export async function GET() {
  return NextResponse.json(
    {
      success: true,

      ready: true,

      message:
        "司機月費試算表同步 API 已就緒",

      features: {
        autoCreateDriver:
          true,

        autoMatchDriver:
          true,

        createMonthlyFeeRecord:
          true,

        protectExistingRecord:
          true,

        overwriteSupported:
          true,
      },

      usage: {
        method:
          "POST",

        endpoint:
          "/api/driver-fees/sync-sheet",

        example: {
          month:
            "2026-08",

          overwrite:
            false,
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