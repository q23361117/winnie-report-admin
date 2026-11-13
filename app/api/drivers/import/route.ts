import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DriverStatus =
  | "active"
  | "resting"
  | "inactive";

type DriverPlan =
  | "joint"
  | "support"
  | "custom";

type ImportDriver = {
  name?: string;
  plate?: string;

  status?: DriverStatus;
  plan?: DriverPlan;

  monthlyFee?: number;
  joinFee?: number;

  joinedAt?: string;
  note?: string;
};

type ImportRequestBody = {
  drivers?: ImportDriver[];

  defaults?: {
    status?: DriverStatus;
    plan?: DriverPlan;

    monthlyFee?: number;
    joinFee?: number;

    joinedAt?: string;
    note?: string;
  };
};

function cleanText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function cleanNumber(
  value: unknown,
  fallback = 0
): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(0, number);
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

function getTaiwanDate(): string {
  const parts =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

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

function normalizePlate(
  value: string
): string {
  return value
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeName(
  value: string
): string {
  return value
    .trim()
    .replace(/\s+/g, " ");
}

function getDefaultMonthlyFee(
  plan: DriverPlan
): number {
  if (plan === "joint") {
    return 1500;
  }

  if (plan === "support") {
    return 1000;
  }

  return 0;
}

export async function POST(
  request: NextRequest
) {
  try {
    let body: ImportRequestBody;

    try {
      body =
        (await request.json()) as ImportRequestBody;
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

    if (
      !Array.isArray(body.drivers) ||
      body.drivers.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "沒有可匯入的司機資料",
        },
        {
          status: 400,
        }
      );
    }

    if (body.drivers.length > 300) {
      return NextResponse.json(
        {
          success: false,
          message:
            "單次最多匯入 300 位司機",
        },
        {
          status: 400,
        }
      );
    }

    const defaults =
      body.defaults ?? {};

    const defaultStatus: DriverStatus =
      isValidStatus(defaults.status)
        ? defaults.status
        : "active";

    const defaultPlan: DriverPlan =
      isValidPlan(defaults.plan)
        ? defaults.plan
        : "joint";

    const defaultMonthlyFee =
      defaults.monthlyFee !== undefined
        ? cleanNumber(
            defaults.monthlyFee,
            getDefaultMonthlyFee(
              defaultPlan
            )
          )
        : getDefaultMonthlyFee(
            defaultPlan
          );

    const defaultJoinFee =
      cleanNumber(
        defaults.joinFee,
        1500
      );

    const defaultJoinedAt =
      cleanText(defaults.joinedAt) ||
      getTaiwanDate();

    const defaultNote =
      cleanText(defaults.note);

    /*
     * 先把 Firebase 現有司機全部抓出來。
     *
     * 用來判斷：
     * 1. 車牌是否已存在
     * 2. 同名司機是否已存在
     */
    const existingSnapshot =
      await adminDb
        .collection("drivers")
        .get();

    const existingPlates =
      new Set<string>();

    const existingNames =
      new Set<string>();

    existingSnapshot.docs.forEach(
      (doc) => {
        const data = doc.data();

        const plate =
          cleanText(data.plate);

        const name =
          cleanText(data.name);

        if (plate) {
          existingPlates.add(
            normalizePlate(plate)
          );
        }

        if (name) {
          existingNames.add(
            normalizeName(name)
              .toLowerCase()
          );
        }
      }
    );

    /*
     * 同一批匯入資料內也要防止重複。
     */
    const incomingPlates =
      new Set<string>();

    const incomingNames =
      new Set<string>();

    const created: Array<{
      id: string;
      name: string;
      plate: string;
    }> = [];

    const skipped: Array<{
      index: number;
      name: string;
      plate: string;
      reason: string;
    }> = [];

    const failed: Array<{
      index: number;
      name: string;
      plate: string;
      reason: string;
    }> = [];

    /*
     * 一筆一筆處理。
     *
     * 這裡故意不用一次 batch 全寫，
     * 因為我們需要知道：
     * 哪一位成功、
     * 哪一位重複、
     * 哪一位失敗。
     */
    for (
      let index = 0;
      index < body.drivers.length;
      index += 1
    ) {
      const item =
        body.drivers[index] ?? {};

      const name =
        normalizeName(
          cleanText(item.name)
        );

      const plate =
        cleanText(item.plate);

      const normalizedPlate =
        normalizePlate(plate);

      const normalizedName =
        name.toLowerCase();

      /*
       * 基本資料驗證
       */
      if (!name) {
        failed.push({
          index,
          name: "",
          plate,
          reason: "司機名稱不可空白",
        });

        continue;
      }

      if (!plate) {
        failed.push({
          index,
          name,
          plate: "",
          reason: "車牌不可空白",
        });

        continue;
      }

      /*
       * Firebase 已經有這個車牌
       */
      if (
        existingPlates.has(
          normalizedPlate
        )
      ) {
        skipped.push({
          index,
          name,
          plate,
          reason:
            "Firebase 已存在相同車牌",
        });

        continue;
      }

      /*
       * Firebase 已經有同名司機
       *
       * 先採安全模式：
       * 同名也不直接重複建立。
       */
      if (
        existingNames.has(
          normalizedName
        )
      ) {
        skipped.push({
          index,
          name,
          plate,
          reason:
            "Firebase 已存在同名司機",
        });

        continue;
      }

      /*
       * 這次匯入清單本身重複
       */
      if (
        incomingPlates.has(
          normalizedPlate
        )
      ) {
        skipped.push({
          index,
          name,
          plate,
          reason:
            "本次匯入資料有重複車牌",
        });

        continue;
      }

      if (
        incomingNames.has(
          normalizedName
        )
      ) {
        skipped.push({
          index,
          name,
          plate,
          reason:
            "本次匯入資料有重複司機名稱",
        });

        continue;
      }

      const status: DriverStatus =
        isValidStatus(item.status)
          ? item.status
          : defaultStatus;

      const plan: DriverPlan =
        isValidPlan(item.plan)
          ? item.plan
          : defaultPlan;

      const monthlyFee =
        item.monthlyFee !== undefined
          ? cleanNumber(
              item.monthlyFee,
              getDefaultMonthlyFee(
                plan
              )
            )
          : body.defaults
                ?.monthlyFee !==
              undefined
            ? defaultMonthlyFee
            : getDefaultMonthlyFee(
                plan
              );

      const joinFee =
        item.joinFee !== undefined
          ? cleanNumber(
              item.joinFee,
              defaultJoinFee
            )
          : defaultJoinFee;

      const joinedAt =
        cleanText(item.joinedAt) ||
        defaultJoinedAt;

      const note =
        cleanText(item.note) ||
        defaultNote;

      const now = new Date();

      const driverData = {
        name,
        plate,

        status,
        plan,

        monthlyFee,
        joinFee,

        joinedAt,
        note,

        /*
         * 後續月費系統會使用。
         */
        createdAt: now,
        updatedAt: now,

        /*
         * 記錄建立來源。
         */
        source: "bulk-import",

        /*
         * 保留未來擴充空間。
         */
        version: 1,
      };

      try {
        const driverRef =
          await adminDb
            .collection("drivers")
            .add(driverData);

        created.push({
          id: driverRef.id,
          name,
          plate,
        });

        /*
         * 成功建立後立即加入 Set，
         * 防止同批後面的資料重複。
         */
        existingPlates.add(
          normalizedPlate
        );

        existingNames.add(
          normalizedName
        );

        incomingPlates.add(
          normalizedPlate
        );

        incomingNames.add(
          normalizedName
        );
      } catch (error) {
        console.error(
          `批次新增司機失敗：${name}`,
          error
        );

        failed.push({
          index,
          name,
          plate,
          reason:
            error instanceof Error
              ? error.message
              : "Firebase 寫入失敗",
        });
      }
    }

    const summary = {
      requested:
        body.drivers.length,

      created:
        created.length,

      skipped:
        skipped.length,

      failed:
        failed.length,
    };

    return NextResponse.json(
      {
        success:
          created.length > 0 ||
          skipped.length > 0,

        message:
          `批次匯入完成：成功 ${summary.created} 位、跳過 ${summary.skipped} 位、失敗 ${summary.failed} 位`,

        summary,

        created,
        skipped,
        failed,
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
      "批次匯入司機失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "批次匯入司機失敗",
      },
      {
        status: 500,
      }
    );
  }
}