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

type PaymentStatus =
  | "unpaid"
  | "partial"
  | "paid"
  | "exempt";

type DriverFeeRecord = {
  id: string;

  month: string;

  driverId: string;

  driverName: string;

  plate: string;

  plan: string;

  status: DriverStatus;

  joinedAt: string | null;

  joinedMonth: string | null;

  isNewDriver: boolean;

  monthlyFee: number;

  joinFee: number;

  totalAmount: number;

  monthlyFeePaidAmount: number;

  joinFeePaidAmount: number;

  paidAmount: number;

  unpaidAmount: number;

  monthlyFeePaid: boolean;

  joinFeePaid: boolean;

  paid: boolean;

  monthlyFeeStatus: PaymentStatus;

  joinFeeStatus: PaymentStatus;

  paymentMethod: string;

  note: string;

  paidAt: string | null;

  monthlyFeePaidAt: string | null;

  joinFeePaidAt: string | null;

  createdAt: string | null;

  updatedAt: string | null;
};

type SaveFeeBody = {
  action?: string;

  month?: string;

  driverId?: string;

  monthlyFee?: number | string;

  joinFee?: number | string;

  monthlyFeePaidAmount?: number | string;

  joinFeePaidAmount?: number | string;

  paidAmount?: number | string;

  monthlyFeePaid?: boolean;

  joinFeePaid?: boolean;

  paid?: boolean;

  paymentMethod?: string;

  note?: string;
};

/* =========================================================
 * 工具
 * =======================================================*/

function getTaiwanMonth(): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Taipei",

        year: "numeric",

        month: "2-digit",
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

function isValidMonth(
  value: string
): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    value
  );
}

function cleanString(
  value: unknown
): string {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value.trim();
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

  const parsed =
    Number(value);

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

function serializeDate(
  value: unknown
): string | null {
  if (!value) {
    return null;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value
  ) {
    const maybeTimestamp =
      value as {
        toDate?: () => Date;
      };

    if (
      typeof maybeTimestamp.toDate ===
      "function"
    ) {
      try {
        return maybeTimestamp
          .toDate()
          .toISOString();
      } catch {
        return null;
      }
    }
  }

  if (
    typeof value === "string"
  ) {
    return value;
  }

  return null;
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

/**
 * 嘗試從日期取得 YYYY-MM。
 *
 * 支援：
 * 2026-09-19
 * 2026/09/19
 * 2026-09
 * Firestore Timestamp
 * Date
 */
function getMonthFromDate(
  value: unknown
): string | null {
  if (!value) {
    return null;
  }

  let dateString: string | null =
    null;

  if (
    value instanceof Date
  ) {
    dateString =
      value.toISOString();
  } else if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value
  ) {
    try {
      const timestamp =
        value as {
          toDate?: () => Date;
        };

      if (
        typeof timestamp.toDate ===
        "function"
      ) {
        dateString =
          timestamp
            .toDate()
            .toISOString();
      }
    } catch {
      dateString = null;
    }
  } else if (
    typeof value === "string"
  ) {
    dateString =
      value.trim();
  }

  if (!dateString) {
    return null;
  }

  const normalized =
    dateString.replace(
      /\//g,
      "-"
    );

  const match =
    normalized.match(
      /^(\d{4})-(\d{1,2})/
    );

  if (!match) {
    return null;
  }

  const year =
    match[1];

  const month =
    String(
      Number(match[2])
    ).padStart(
      2,
      "0"
    );

  const result =
    `${year}-${month}`;

  return isValidMonth(result)
    ? result
    : null;
}

function getPaymentStatus(
  expectedAmount: number,
  paidAmount: number
): PaymentStatus {
  if (
    expectedAmount <= 0
  ) {
    return "exempt";
  }

  if (
    paidAmount <= 0
  ) {
    return "unpaid";
  }

  if (
    paidAmount >=
    expectedAmount
  ) {
    return "paid";
  }

  return "partial";
}

/**
 * 判斷司機在指定月份是否已加入。
 *
 * 沒有 joinedAt 的舊資料：
 * 為了相容舊系統，仍顯示。
 */
function driverExistsInMonth(
  joinedMonth: string | null,
  month: string
): boolean {
  if (!joinedMonth) {
    return true;
  }

  return (
    joinedMonth <= month
  );
}

/* =========================================================
 * 建立標準化紀錄
 * =======================================================*/

function buildRecord(
  month: string,
  driverId: string,
  driver: Record<
    string,
    unknown
  >,
  feeRecord?: Record<
    string,
    unknown
  >
): DriverFeeRecord {
  const status =
    normalizeStatus(
      feeRecord?.status ??
        driver.status
    );

  const driverName =
    typeof feeRecord?.driverName ===
      "string"
      ? feeRecord.driverName
      : typeof driver.name ===
          "string"
        ? driver.name
        : "";

  const plate =
    typeof feeRecord?.plate ===
      "string"
      ? feeRecord.plate
      : typeof driver.plate ===
          "string"
        ? driver.plate
        : "";

  const plan =
    typeof feeRecord?.plan ===
      "string"
      ? feeRecord.plan
      : typeof driver.plan ===
          "string"
        ? driver.plan
        : "";

  const joinedAt =
    serializeDate(
      feeRecord?.joinedAt ??
        driver.joinedAt
    );

  const joinedMonth =
    typeof feeRecord?.joinedMonth ===
      "string" &&
    isValidMonth(
      feeRecord.joinedMonth
    )
      ? feeRecord.joinedMonth
      : getMonthFromDate(
          driver.joinedAt
        );

  const isNewDriver =
    joinedMonth === month;

  const monthlyFee =
    feeRecord
      ? parseMoney(
          feeRecord.monthlyFee
        )
      : parseMoney(
          driver.monthlyFee
        );

  /*
   * 入會費：
   *
   * 只有加入當月才自動帶入。
   *
   * 已有歷史紀錄時，
   * 尊重歷史紀錄的 joinFee。
   */
  const defaultJoinFee =
    isNewDriver
      ? parseMoney(
          driver.joinFee
        )
      : 0;

  const joinFee =
    feeRecord
      ? parseMoney(
          feeRecord.joinFee
        )
      : defaultJoinFee;

  const totalAmount =
    monthlyFee +
    joinFee;

  /*
   * 新版：
   * 月費與入會費分開記。
   *
   * 舊版資料只有 paidAmount，
   * 需要向下相容。
   */
  let monthlyFeePaidAmount =
    parseMoney(
      feeRecord?.monthlyFeePaidAmount
    );

  let joinFeePaidAmount =
    parseMoney(
      feeRecord?.joinFeePaidAmount
    );

  const oldPaidAmount =
    parseMoney(
      feeRecord?.paidAmount
    );

  const hasNewPaymentFields =
    feeRecord &&
    (
      feeRecord.monthlyFeePaidAmount !==
        undefined ||
      feeRecord.joinFeePaidAmount !==
        undefined
    );

  /*
   * 舊資料轉換：
   *
   * 先分配到月費，
   * 剩餘再分配到入會費。
   */
  if (
    feeRecord &&
    !hasNewPaymentFields &&
    oldPaidAmount > 0
  ) {
    monthlyFeePaidAmount =
      Math.min(
        oldPaidAmount,
        monthlyFee
      );

    joinFeePaidAmount =
      Math.min(
        Math.max(
          0,
          oldPaidAmount -
            monthlyFeePaidAmount
        ),
        joinFee
      );
  }

  monthlyFeePaidAmount =
    Math.min(
      monthlyFeePaidAmount,
      monthlyFee
    );

  joinFeePaidAmount =
    Math.min(
      joinFeePaidAmount,
      joinFee
    );

  const monthlyFeePaid =
    monthlyFee <= 0 ||
    feeRecord?.monthlyFeePaid ===
      true ||
    monthlyFeePaidAmount >=
      monthlyFee;

  const joinFeePaid =
    joinFee <= 0 ||
    feeRecord?.joinFeePaid ===
      true ||
    joinFeePaidAmount >=
      joinFee;

  const paidAmount =
    monthlyFeePaidAmount +
    joinFeePaidAmount;

  const unpaidAmount =
    Math.max(
      0,
      totalAmount -
        paidAmount
    );

  const paid =
    totalAmount <= 0 ||
    (
      monthlyFeePaid &&
      joinFeePaid
    );

  return {
    id:
      typeof feeRecord?.id ===
        "string"
        ? feeRecord.id
        : `${month}_${driverId}`,

    month,

    driverId,

    driverName,

    plate,

    plan,

    status,

    joinedAt,

    joinedMonth,

    isNewDriver,

    monthlyFee,

    joinFee,

    totalAmount,

    monthlyFeePaidAmount,

    joinFeePaidAmount,

    paidAmount,

    unpaidAmount,

    monthlyFeePaid,

    joinFeePaid,

    paid,

    monthlyFeeStatus:
      getPaymentStatus(
        monthlyFee,
        monthlyFeePaidAmount
      ),

    joinFeeStatus:
      getPaymentStatus(
        joinFee,
        joinFeePaidAmount
      ),

    paymentMethod:
      typeof feeRecord?.paymentMethod ===
        "string"
        ? feeRecord.paymentMethod
        : "",

    note:
      typeof feeRecord?.note ===
        "string"
        ? feeRecord.note
        : "",

    paidAt:
      serializeDate(
        feeRecord?.paidAt
      ),

    monthlyFeePaidAt:
      serializeDate(
        feeRecord?.monthlyFeePaidAt
      ),

    joinFeePaidAt:
      serializeDate(
        feeRecord?.joinFeePaidAt
      ),

    createdAt:
      serializeDate(
        feeRecord?.createdAt
      ),

    updatedAt:
      serializeDate(
        feeRecord?.updatedAt
      ),
  };
}

/* =========================================================
 * GET
 *
 * 取得指定月份完整司機帳本
 *
 * /api/driver-fees?month=2026-09
 * =======================================================*/

export async function GET(
  request: NextRequest
) {
  try {
    const { searchParams } = new URL(request.url);

    const month =
      searchParams.get("month")?.trim() ||
      getTaiwanMonth();

    if (!isValidMonth(month)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "月份格式錯誤，正確格式例如：2026-09",
        },
        { status: 400 }
      );
    }

    /*
     * =====================================================
     * 月份帳本以 driverFeeRecords 為唯一來源
     * =====================================================
     *
     * 不再從目前 drivers 主檔自動補司機進舊月份。
     *
     * 因此：
     * 1. 刪除某月紀錄後，重新整理不會再出現。
     * 2. 10 月新增的司機不會跑回 9 月。
     * 3. 每個月份都是獨立帳本。
     * 4. 就算日後刪除司機主檔，歷史帳仍保留。
     */

    const feeSnapshot =
      await adminDb
        .collection("driverFeeRecords")
        .where("month", "==", month)
        .get();

    const records: DriverFeeRecord[] = [];

    for (const feeDoc of feeSnapshot.docs) {
      const feeRecord = {
        id: feeDoc.id,
        ...feeDoc.data(),
      } as Record<string, unknown>;

      const driverId =
        typeof feeRecord.driverId === "string"
          ? feeRecord.driverId
          : "";

      if (!driverId) {
        continue;
      }

      records.push(
        buildRecord(
          month,
          driverId,
          {},
          feeRecord
        )
      );
    }

    /*
     * 排序：
     * 1. 本月新加入
     * 2. 跑車中
     * 3. 休息
     * 4. 退出
     * 5. 名稱
     */
    const statusOrder: Record<
      DriverStatus,
      number
    > = {
      active: 0,
      resting: 1,
      inactive: 2,
    };

    records.sort((a, b) => {
      if (a.isNewDriver !== b.isNewDriver) {
        return a.isNewDriver ? -1 : 1;
      }

      const statusDiff =
        statusOrder[a.status] -
        statusOrder[b.status];

      if (statusDiff !== 0) {
        return statusDiff;
      }

      return a.driverName.localeCompare(
        b.driverName,
        "zh-Hant"
      );
    });

    /*
     * active + resting 列入當月應收。
     * inactive 保留歷史紀錄，但不列入應收。
     */
    const activeRecords =
      records.filter(
        (record) =>
          record.status !== "inactive"
      );

    const totalDrivers = records.length;
    const retainedDrivers =
      activeRecords.length;

    const active =
      records.filter(
        (record) =>
          record.status === "active"
      ).length;

    const resting =
      records.filter(
        (record) =>
          record.status === "resting"
      ).length;

    const inactive =
      records.filter(
        (record) =>
          record.status === "inactive"
      ).length;

    const newDrivers =
      activeRecords.filter(
        (record) => record.isNewDriver
      ).length;

    /*
     * 月費統計
     */
    const monthlyFeeExpected =
      activeRecords.reduce(
        (sum, record) =>
          sum + record.monthlyFee,
        0
      );

    const monthlyFeeIncome =
      activeRecords.reduce(
        (sum, record) =>
          sum +
          record.monthlyFeePaidAmount,
        0
      );

    const monthlyFeeUnpaid =
      Math.max(
        0,
        monthlyFeeExpected -
          monthlyFeeIncome
      );

    const monthlyFeePaidCount =
      activeRecords.filter(
        (record) =>
          record.monthlyFee > 0 &&
          record.monthlyFeeStatus ===
            "paid"
      ).length;

    const monthlyFeePartialCount =
      activeRecords.filter(
        (record) =>
          record.monthlyFeeStatus ===
          "partial"
      ).length;

    const monthlyFeeUnpaidCount =
      activeRecords.filter(
        (record) =>
          record.monthlyFeeStatus ===
          "unpaid"
      ).length;

    const monthlyFeeExemptCount =
      activeRecords.filter(
        (record) =>
          record.monthlyFeeStatus ===
          "exempt"
      ).length;

    const monthlyFeePaymentRate =
      monthlyFeeExpected > 0
        ? Math.round(
            (monthlyFeeIncome /
              monthlyFeeExpected) *
              1000
          ) / 10
        : 0;

    /*
     * 入會費統計
     */
    const joinFeeExpected =
      activeRecords.reduce(
        (sum, record) =>
          sum + record.joinFee,
        0
      );

    const joinFeeIncome =
      activeRecords.reduce(
        (sum, record) =>
          sum +
          record.joinFeePaidAmount,
        0
      );

    const joinFeeUnpaid =
      Math.max(
        0,
        joinFeeExpected -
          joinFeeIncome
      );

    const joinFeeRequiredCount =
      activeRecords.filter(
        (record) =>
          record.joinFee > 0
      ).length;

    const joinFeePaidCount =
      activeRecords.filter(
        (record) =>
          record.joinFee > 0 &&
          record.joinFeeStatus === "paid"
      ).length;

    const joinFeeUnpaidCount =
      activeRecords.filter(
        (record) =>
          record.joinFee > 0 &&
          record.joinFeeStatus !== "paid"
      ).length;

    /*
     * 總帳
     */
    const expectedAmount =
      monthlyFeeExpected +
      joinFeeExpected;

    const paidAmount =
      monthlyFeeIncome +
      joinFeeIncome;

    const unpaidAmount =
      Math.max(
        0,
        expectedAmount - paidAmount
      );

    const paidCount =
      activeRecords.filter(
        (record) =>
          record.totalAmount > 0 &&
          record.paid
      ).length;

    const unpaidCount =
      activeRecords.filter(
        (record) =>
          record.totalAmount > 0 &&
          !record.paid
      ).length;

    const paymentRate =
      expectedAmount > 0
        ? Math.round(
            (paidAmount /
              expectedAmount) *
              1000
          ) / 10
        : 0;

    /*
     * 有至少一筆 driverFeeRecords，
     * 代表這個月份已建立帳本。
     */
    const initialized =
      feeSnapshot.size > 0;

    return NextResponse.json(
      {
        success: true,

        month,

        initialized,

        recordCount: records.length,

        records,

        summary: {
          totalDrivers,
          retainedDrivers,
          active,
          resting,
          inactive,
          newDrivers,

          monthlyFeeExpected,
          monthlyFeeIncome,
          monthlyFeeUnpaid,
          monthlyFeePaidCount,
          monthlyFeePartialCount,
          monthlyFeeUnpaidCount,
          monthlyFeeExemptCount,
          monthlyFeePaymentRate,

          joinFeeExpected,
          joinFeeIncome,
          joinFeeUnpaid,
          joinFeeRequiredCount,
          joinFeePaidCount,
          joinFeeUnpaidCount,

          expectedAmount,
          paidAmount,
          unpaidAmount,
          paidCount,
          unpaidCount,
          paymentRate,
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
  } catch (error) {
    console.error(
      "讀取司機月費失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "讀取司機月費失敗",
      },
      { status: 500 }
    );
  }
}

/* =========================================================
 * POST
 *
 * 兩種用途：
 *
 * 1. 更新單一司機當月繳費
 *
 * 2. initializeMonth
 *    建立 / 凍結整個月份帳本
 * =======================================================*/

export async function POST(
  request: NextRequest
) {
  try {
    let body: SaveFeeBody;

    try {
      body =
        (await request.json()) as
          SaveFeeBody;
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

    /*
     * =====================================================
     * 建立整個月份帳本
     *
     * POST
     * {
     *   action: "initializeMonth",
     *   month: "2026-10"
     * }
     * ===================================================*/
    if (
      body.action ===
      "initializeMonth"
    ) {
      const driversSnapshot =
        await adminDb
          .collection(
            "drivers"
          )
          .get();

      const batch =
        adminDb.batch();

      let createdCount = 0;

      let existingCount = 0;

      let skippedFutureCount =
        0;

      const now =
        new Date();

      for (
        const driverDoc of
        driversSnapshot.docs
      ) {
        const driver =
          driverDoc.data();

        const driverId =
          driverDoc.id;

        const joinedAt =
          serializeDate(
            driver.joinedAt
          );

        const joinedMonth =
          getMonthFromDate(
            driver.joinedAt
          );

        /*
         * 尚未加入的司機不放入
         * 這個月份。
         */
        if (
          !driverExistsInMonth(
            joinedMonth,
            month
          )
        ) {
          skippedFutureCount +=
            1;

          continue;
        }

        const recordId =
          `${month}_${driverId}`;

        const recordRef =
          adminDb
            .collection(
              "driverFeeRecords"
            )
            .doc(
              recordId
            );

        const existingSnapshot =
          await recordRef.get();

        /*
         * 已經建立過就不覆蓋。
         *
         * 避免重新建立月份時，
         * 把已繳紀錄洗掉。
         */
        if (
          existingSnapshot.exists
        ) {
          existingCount += 1;

          continue;
        }

        const status =
          normalizeStatus(
            driver.status
          );

        const driverName =
          typeof driver.name ===
            "string"
            ? driver.name
            : "";

        const plate =
          typeof driver.plate ===
            "string"
            ? driver.plate
            : "";

        const plan =
          typeof driver.plan ===
            "string"
            ? driver.plan
            : "";

        const monthlyFee =
          parseMoney(
            driver.monthlyFee
          );

        const isNewDriver =
          joinedMonth ===
          month;

        /*
         * 入會費只會出現在
         * 加入月份。
         */
        const joinFee =
          isNewDriver
            ? parseMoney(
                driver.joinFee
              )
            : 0;

        const totalAmount =
          monthlyFee +
          joinFee;

        batch.set(
          recordRef,
          {
            month,

            driverId,

            driverName,

            plate,

            plan,

            status,

            joinedAt,

            joinedMonth,

            isNewDriver,

            monthlyFee,

            joinFee,

            totalAmount,

            monthlyFeePaidAmount:
              0,

            joinFeePaidAmount:
              0,

            paidAmount: 0,

            unpaidAmount:
              totalAmount,

            monthlyFeePaid:
              monthlyFee <= 0,

            joinFeePaid:
              joinFee <= 0,

            paid:
              totalAmount <= 0,

            paymentMethod: "",

            note: "",

            paidAt: null,

            monthlyFeePaidAt:
              null,

            joinFeePaidAt:
              null,

            createdAt: now,

            updatedAt: now,
          }
        );

        createdCount += 1;
      }

      if (
        createdCount > 0
      ) {
        await batch.commit();
      }

      return NextResponse.json(
        {
          success: true,

          message:
            `${month} 月份帳本建立完成`,

          month,

          createdCount,

          existingCount,

          skippedFutureCount,

          totalDrivers:
            driversSnapshot.size,
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

    /* =====================================================
     * 更新單一司機繳費
     * ===================================================*/

    const driverId =
      cleanString(
        body.driverId
      );

    if (!driverId) {
      return NextResponse.json(
        {
          success: false,

          message:
            "缺少司機 ID",
        },
        {
          status: 400,
        }
      );
    }

    const driverRef =
      adminDb
        .collection(
          "drivers"
        )
        .doc(
          driverId
        );

    const driverSnapshot =
      await driverRef.get();

    /*
     * 如果主檔不存在，
     * 但歷史帳本存在，
     * 還是允許修改歷史資料。
     */
    const recordId =
      `${month}_${driverId}`;

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

    if (
      !driverSnapshot.exists &&
      !oldSnapshot.exists
    ) {
      return NextResponse.json(
        {
          success: false,

          message:
            "找不到這位司機",
        },
        {
          status: 404,
        }
      );
    }

    const driver =
      driverSnapshot.exists
        ? driverSnapshot.data() ??
          {}
        : {};

    const oldData =
      oldSnapshot.exists
        ? oldSnapshot.data() ??
          {}
        : {};

    const driverName =
      typeof oldData.driverName ===
        "string"
        ? oldData.driverName
        : typeof driver.name ===
            "string"
          ? driver.name
          : "";

    const plate =
      typeof oldData.plate ===
        "string"
        ? oldData.plate
        : typeof driver.plate ===
            "string"
          ? driver.plate
          : "";

    const plan =
      typeof oldData.plan ===
        "string"
        ? oldData.plan
        : typeof driver.plan ===
            "string"
          ? driver.plan
          : "";

    const status =
      normalizeStatus(
        oldData.status ??
          driver.status
      );

    const joinedAt =
      serializeDate(
        oldData.joinedAt ??
          driver.joinedAt
      );

    const joinedMonth =
      typeof oldData.joinedMonth ===
        "string" &&
      isValidMonth(
        oldData.joinedMonth
      )
        ? oldData.joinedMonth
        : getMonthFromDate(
            driver.joinedAt
          );

    const isNewDriver =
      joinedMonth === month;

    /*
     * 應收月費
     */
    const monthlyFee =
      body.monthlyFee !==
      undefined
        ? parseMoney(
            body.monthlyFee
          )
        : oldSnapshot.exists
          ? parseMoney(
              oldData.monthlyFee
            )
          : parseMoney(
              driver.monthlyFee
            );

    /*
     * 應收入會費
     */
    const joinFee =
      body.joinFee !==
      undefined
        ? parseMoney(
            body.joinFee
          )
        : oldSnapshot.exists
          ? parseMoney(
              oldData.joinFee
            )
          : isNewDriver
            ? parseMoney(
                driver.joinFee
              )
            : 0;

    const totalAmount =
      monthlyFee +
      joinFee;

    /* =====================================================
     * 已收月費
     * ===================================================*/

    let monthlyFeePaidAmount =
      body.monthlyFeePaidAmount !==
      undefined
        ? parseMoney(
            body.monthlyFeePaidAmount
          )
        : parseMoney(
            oldData.monthlyFeePaidAmount
          );

    /*
     * 如果直接標記月費已繳，
     * 自動填滿。
     */
    if (
      body.monthlyFeePaid ===
      true
    ) {
      monthlyFeePaidAmount =
        monthlyFee;
    }

    if (
      body.monthlyFeePaid ===
      false
    ) {
      monthlyFeePaidAmount =
        0;
    }

    /* =====================================================
     * 已收入會費
     * ===================================================*/

    let joinFeePaidAmount =
      body.joinFeePaidAmount !==
      undefined
        ? parseMoney(
            body.joinFeePaidAmount
          )
        : parseMoney(
            oldData.joinFeePaidAmount
          );

    if (
      body.joinFeePaid ===
      true
    ) {
      joinFeePaidAmount =
        joinFee;
    }

    if (
      body.joinFeePaid ===
      false
    ) {
      joinFeePaidAmount =
        0;
    }

    /*
     * 相容你現在舊版前端。
     *
     * 舊前端可能仍只傳：
     *
     * paidAmount
     * paid
     *
     * 所以不能讓舊畫面突然失效。
     */
    if (
      body.paidAmount !==
        undefined &&
      body.monthlyFeePaidAmount ===
        undefined &&
      body.joinFeePaidAmount ===
        undefined
    ) {
      const oldStylePaid =
        parseMoney(
          body.paidAmount
        );

      monthlyFeePaidAmount =
        Math.min(
          oldStylePaid,
          monthlyFee
        );

      joinFeePaidAmount =
        Math.min(
          Math.max(
            0,
            oldStylePaid -
              monthlyFeePaidAmount
          ),
          joinFee
        );
    }

    if (
      body.paid === true &&
      body.monthlyFeePaidAmount ===
        undefined &&
      body.joinFeePaidAmount ===
        undefined &&
      body.paidAmount ===
        undefined
    ) {
      monthlyFeePaidAmount =
        monthlyFee;

      joinFeePaidAmount =
        joinFee;
    }

    if (
      body.paid === false &&
      body.monthlyFeePaidAmount ===
        undefined &&
      body.joinFeePaidAmount ===
        undefined &&
      body.paidAmount ===
        undefined &&
      body.monthlyFeePaid ===
        undefined &&
      body.joinFeePaid ===
        undefined
    ) {
      monthlyFeePaidAmount =
        0;

      joinFeePaidAmount =
        0;
    }

    /*
     * 不可超收
     */
    monthlyFeePaidAmount =
      Math.min(
        monthlyFeePaidAmount,
        monthlyFee
      );

    joinFeePaidAmount =
      Math.min(
        joinFeePaidAmount,
        joinFee
      );

    const monthlyFeePaid =
      monthlyFee <= 0 ||
      monthlyFeePaidAmount >=
        monthlyFee;

    const joinFeePaid =
      joinFee <= 0 ||
      joinFeePaidAmount >=
        joinFee;

    const paidAmount =
      monthlyFeePaidAmount +
      joinFeePaidAmount;

    const unpaidAmount =
      Math.max(
        0,
        totalAmount -
          paidAmount
      );

    const paid =
      totalAmount <= 0 ||
      (
        monthlyFeePaid &&
        joinFeePaid
      );

    const paymentMethod =
      body.paymentMethod !==
      undefined
        ? cleanString(
            body.paymentMethod
          )
        : cleanString(
            oldData.paymentMethod
          );

    const note =
      body.note !==
      undefined
        ? cleanString(
            body.note
          )
        : cleanString(
            oldData.note
          );

    const now =
      new Date();

    /* =====================================================
     * 繳費日期
     * ===================================================*/

    let monthlyFeePaidAt:
      unknown =
      oldData.monthlyFeePaidAt ??
      null;

    if (
      monthlyFeePaid &&
      !oldData.monthlyFeePaid
    ) {
      monthlyFeePaidAt =
        now;
    }

    if (
      !monthlyFeePaid
    ) {
      monthlyFeePaidAt =
        null;
    }

    let joinFeePaidAt:
      unknown =
      oldData.joinFeePaidAt ??
      null;

    if (
      joinFeePaid &&
      joinFee > 0 &&
      !oldData.joinFeePaid
    ) {
      joinFeePaidAt =
        now;
    }

    if (
      !joinFeePaid
    ) {
      joinFeePaidAt =
        null;
    }

    let paidAt:
      unknown =
      oldData.paidAt ??
      null;

    if (
      paid &&
      oldData.paid !== true
    ) {
      paidAt = now;
    }

    if (!paid) {
      paidAt = null;
    }

    const recordData = {
      month,

      driverId,

      /*
       * 當月快照
       */
      driverName,

      plate,

      plan,

      status,

      joinedAt,

      joinedMonth,

      isNewDriver,

      /*
       * 應收
       */
      monthlyFee,

      joinFee,

      totalAmount,

      /*
       * 實收
       */
      monthlyFeePaidAmount,

      joinFeePaidAmount,

      paidAmount,

      unpaidAmount,

      /*
       * 狀態
       */
      monthlyFeePaid,

      joinFeePaid,

      paid,

      monthlyFeeStatus:
        getPaymentStatus(
          monthlyFee,
          monthlyFeePaidAmount
        ),

      joinFeeStatus:
        getPaymentStatus(
          joinFee,
          joinFeePaidAmount
        ),

      paymentMethod,

      note,

      monthlyFeePaidAt,

      joinFeePaidAt,

      paidAt,

      createdAt:
        oldData.createdAt ??
        now,

      updatedAt: now,
    };

    await recordRef.set(
      recordData,
      {
        merge: true,
      }
    );

    const savedSnapshot =
      await recordRef.get();

    if (
      !savedSnapshot.exists
    ) {
      throw new Error(
        "月費紀錄寫入後驗證失敗"
      );
    }

    const saved =
      savedSnapshot.data() ??
      {};

    return NextResponse.json(
      {
        success: true,

        message:
          `${driverName} ${month} 繳費紀錄已更新`,

        record: {
          id:
            savedSnapshot.id,

          ...saved,

          joinedAt:
            serializeDate(
              saved.joinedAt
            ),

          paidAt:
            serializeDate(
              saved.paidAt
            ),

          monthlyFeePaidAt:
            serializeDate(
              saved.monthlyFeePaidAt
            ),

          joinFeePaidAt:
            serializeDate(
              saved.joinFeePaidAt
            ),

          createdAt:
            serializeDate(
              saved.createdAt
            ),

          updatedAt:
            serializeDate(
              saved.updatedAt
            ),
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
  } catch (error) {
    console.error(
      "儲存司機月費失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "儲存司機月費失敗",
      },
      {
        status: 500,
      }
    );
  }
}