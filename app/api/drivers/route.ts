import {
  NextRequest,
  NextResponse,
} from "next/server";

import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================================================
 * 型別
 * ======================================================= */

type DriverStatus =
  | "active"
  | "resting"
  | "inactive";

type DriverPlan =
  | "joint"
  | "support"
  | "custom";

type CreateDriverBody = {
  name?: string;
  plate?: string;

  status?: DriverStatus;
  plan?: DriverPlan;

  monthlyFee?: number | string;
  joinFee?: number | string;

  joinedAt?: string;

  note?: string;
};

/* =========================================================
 * 共用工具
 * ======================================================= */

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizePlate(value: unknown): string {
  return normalizeText(value)
    .replace(/\s+/g, "")
    .toUpperCase();
}

function parseMoney(
  value: unknown,
  fallback = 0
): number {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .replace(/,/g, "")
            .trim()
        );

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return fallback;
  }

  return Math.round(parsed);
}

function getTaiwanDate(): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).formatToParts(new Date());

  const year =
    parts.find(
      (part) => part.type === "year"
    )?.value ?? "";

  const month =
    parts.find(
      (part) => part.type === "month"
    )?.value ?? "";

  const day =
    parts.find(
      (part) => part.type === "day"
    )?.value ?? "";

  return `${year}-${month}-${day}`;
}

function isValidDate(
  value: string
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    return false;
  }

  const date = new Date(
    `${value}T00:00:00+08:00`
  );

  return !Number.isNaN(
    date.getTime()
  );
}

function isValidStatus(
  value: unknown
): value is DriverStatus {
  return (
    value === "active" ||
    value === "resting" ||
    value === "inactive"
  );
}

function isValidPlan(
  value: unknown
): value is DriverPlan {
  return (
    value === "joint" ||
    value === "support" ||
    value === "custom"
  );
}

/* =========================================================
 * 方案預設月費
 *
 * joint   = 維尼聯合調度
 * support = 維尼支援司機
 * custom  = 自訂
 *
 * 後台仍可以手動修改 monthlyFee。
 * ======================================================= */

function getDefaultMonthlyFee(
  plan: DriverPlan
): number {
  switch (plan) {
    case "joint":
      return 1500;

    case "support":
      return 1000;

    case "custom":
      return 0;

    default:
      return 0;
  }
}

/* =========================================================
 * Firestore 文件轉前端格式
 * ======================================================= */

function serializeTimestamp(
  value: unknown
): string | null {
  if (!value) {
    return null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (
      value as {
        toDate?: unknown;
      }
    ).toDate === "function"
  ) {
    try {
      return (
        value as {
          toDate: () => Date;
        }
      )
        .toDate()
        .toISOString();
    } catch {
      return null;
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return null;
}

function serializeDriver(
  id: string,
  data: Record<string, unknown>
) {
  return {
    id,

    name:
      typeof data.name === "string"
        ? data.name
        : "",

    plate:
      typeof data.plate === "string"
        ? data.plate
        : "",

    status:
      typeof data.status === "string"
        ? data.status
        : "active",

    plan:
      typeof data.plan === "string"
        ? data.plan
        : "joint",

    monthlyFee:
      typeof data.monthlyFee ===
      "number"
        ? data.monthlyFee
        : 0,

    joinFee:
      typeof data.joinFee ===
      "number"
        ? data.joinFee
        : 0,

    joinedAt:
      typeof data.joinedAt ===
      "string"
        ? data.joinedAt
        : "",

    restStartedAt:
      typeof data.restStartedAt ===
      "string"
        ? data.restStartedAt
        : null,

    inactiveAt:
      typeof data.inactiveAt ===
      "string"
        ? data.inactiveAt
        : null,

    note:
      typeof data.note === "string"
        ? data.note
        : "",

    createdAt:
      serializeTimestamp(
        data.createdAt
      ),

    updatedAt:
      serializeTimestamp(
        data.updatedAt
      ),
  };
}

/* =========================================================
 * GET
 *
 * 取得所有司機
 *
 * /api/drivers
 *
 * 可選：
 *
 * /api/drivers?status=active
 * /api/drivers?status=resting
 * /api/drivers?status=inactive
 * ======================================================= */

export async function GET(
  request: NextRequest
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const status =
      searchParams.get("status");

    const snapshot =
      await adminDb
        .collection("drivers")
        .get();

    let drivers =
      snapshot.docs.map(
        (doc) =>
          serializeDriver(
            doc.id,
            doc.data()
          )
      );

    /*
     * 狀態篩選
     *
     * 先在程式內篩選，
     * 暫時不需要另外建立
     * Firestore composite index。
     */
    if (
      status &&
      isValidStatus(status)
    ) {
      drivers = drivers.filter(
        (driver) =>
          driver.status === status
      );
    }

    /*
     * 排序：
     *
     * 跑車中
     * ↓
     * 休息
     * ↓
     * 已退出
     */
    const statusOrder:
      Record<string, number> = {
        active: 1,
        resting: 2,
        inactive: 3,
      };

    drivers.sort((a, b) => {
      const statusCompare =
        (statusOrder[a.status] ?? 99) -
        (statusOrder[b.status] ?? 99);

      if (statusCompare !== 0) {
        return statusCompare;
      }

      return a.name.localeCompare(
        b.name,
        "zh-Hant"
      );
    });

    const summary = {
      total: drivers.length,

      active:
        drivers.filter(
          (driver) =>
            driver.status ===
            "active"
        ).length,

      resting:
        drivers.filter(
          (driver) =>
            driver.status ===
            "resting"
        ).length,

      inactive:
        drivers.filter(
          (driver) =>
            driver.status ===
            "inactive"
        ).length,
    };

    return NextResponse.json(
      {
        success: true,

        drivers,

        summary,
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
      "取得司機資料失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "取得司機資料失敗",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
 * POST
 *
 * 新增司機
 *
 * POST /api/drivers
 *
 * 範例：
 *
 * {
 *   "name": "菲比",
 *   "plate": "7975灰",
 *   "plan": "joint",
 *   "monthlyFee": 1500,
 *   "joinFee": 1500,
 *   "joinedAt": "2026-09-15",
 *   "status": "active",
 *   "note": ""
 * }
 * ======================================================= */

export async function POST(
  request: NextRequest
) {
  try {
    let body: CreateDriverBody;

    try {
      body =
        (await request.json()) as CreateDriverBody;
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

    /* -----------------------------
     * 基本資料
     * --------------------------- */

    const name =
      normalizeText(body.name);

    const plate =
      normalizePlate(body.plate);

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          message:
            "請輸入司機名稱",
        },
        {
          status: 400,
        }
      );
    }

    if (!plate) {
      return NextResponse.json(
        {
          success: false,
          message:
            "請輸入車牌／顏色",
        },
        {
          status: 400,
        }
      );
    }

    /* -----------------------------
     * 狀態
     * --------------------------- */

    const status: DriverStatus =
      isValidStatus(body.status)
        ? body.status
        : "active";

    /* -----------------------------
     * 方案
     * --------------------------- */

    const plan: DriverPlan =
      isValidPlan(body.plan)
        ? body.plan
        : "joint";

    /* -----------------------------
     * 月費
     * --------------------------- */

    const defaultMonthlyFee =
      getDefaultMonthlyFee(plan);

    const monthlyFee =
      body.monthlyFee ===
        undefined ||
      body.monthlyFee === ""
        ? defaultMonthlyFee
        : parseMoney(
            body.monthlyFee,
            defaultMonthlyFee
          );

    /* -----------------------------
     * 入會費
     *
     * 預設 1500
     * --------------------------- */

    const joinFee =
      parseMoney(
        body.joinFee,
        1500
      );

    /* -----------------------------
     * 加入日期
     * --------------------------- */

    const joinedAt =
      normalizeText(
        body.joinedAt
      ) || getTaiwanDate();

    if (!isValidDate(joinedAt)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "加入日期格式錯誤",
        },
        {
          status: 400,
        }
      );
    }

    const note =
      normalizeText(body.note);

    /* =====================================================
     * 防止車牌重複
     * =================================================== */

    const existingSnapshot =
      await adminDb
        .collection("drivers")
        .where(
          "plate",
          "==",
          plate
        )
        .limit(1)
        .get();

    if (!existingSnapshot.empty) {
      const existingDoc =
        existingSnapshot.docs[0];

      return NextResponse.json(
        {
          success: false,

          code:
            "DUPLICATE_PLATE",

          message:
            `車牌 ${plate} 已經存在`,

          driverId:
            existingDoc.id,
        },
        {
          status: 409,
        }
      );
    }

    /* =====================================================
     * 建立司機
     * =================================================== */

    const now = new Date();

    const driverData = {
      name,

      plate,

      status,

      plan,

      monthlyFee,

      joinFee,

      joinedAt,

      /*
       * 休息開始日期
       */
      restStartedAt:
        status === "resting"
          ? getTaiwanDate()
          : null,

      /*
       * 退出日期
       */
      inactiveAt:
        status === "inactive"
          ? getTaiwanDate()
          : null,

      note,

      createdAt: now,

      updatedAt: now,

      source: "admin",

      version: 1,
    };

    const driverRef =
      await adminDb
        .collection("drivers")
        .add(driverData);

    /* =====================================================
     * 寫入後驗證
     * =================================================== */

    const verifySnapshot =
      await driverRef.get();

    if (!verifySnapshot.exists) {
      throw new Error(
        "司機資料寫入後驗證失敗"
      );
    }

    const savedData =
      verifySnapshot.data();

    if (!savedData) {
      throw new Error(
        "無法取得新增後的司機資料"
      );
    }

    return NextResponse.json(
      {
        success: true,

        message:
          "司機新增成功",

        driver:
          serializeDriver(
            verifySnapshot.id,
            savedData
          ),
      },
      {
        status: 201,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "新增司機失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "新增司機失敗",
      },
      {
        status: 500,
      }
    );
  }
}