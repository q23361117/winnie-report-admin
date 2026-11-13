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

type DriverPlan =
  | "dispatch"
  | "support"
  | "other";

type DriverUpdateBody = {
  name?: string;
  plate?: string;
  phone?: string;

  status?: DriverStatus;

  plan?: DriverPlan;

  monthlyFee?: number | string;
  joinFee?: number | string;

  paymentMethod?: string;
  paid?: boolean;

  note?: string;

  joinedAt?: string | null;
};

/* =========================================================
 * 工具
 * =======================================================*/

function cleanString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function parseMoney(
  value: unknown
): number | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return undefined;
  }

  if (numberValue < 0) {
    return undefined;
  }

  return Math.round(numberValue);
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
    value === "dispatch" ||
    value === "support" ||
    value === "other"
  );
}

/* =========================================================
 * Firestore 資料轉 JSON
 * =======================================================*/

function serializeDriver(
  id: string,
  data: Record<string, unknown>
) {
  const convertDate = (
    value: unknown
  ): unknown => {
    if (
      value &&
      typeof value === "object" &&
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
        return value;
      }
    }

    return value;
  };

  return {
    id,

    ...data,

    createdAt: convertDate(
      data.createdAt
    ),

    updatedAt: convertDate(
      data.updatedAt
    ),

    joinedAt: convertDate(
      data.joinedAt
    ),

    statusChangedAt: convertDate(
      data.statusChangedAt
    ),
  };
}

/* =========================================================
 * GET
 *
 * 取得單一司機
 *
 * GET /api/drivers/xxxxx
 * =======================================================*/

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id } =
      await context.params;

    const driverId =
      decodeURIComponent(
        id
      ).trim();

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
        .collection("drivers")
        .doc(driverId);

    const snapshot =
      await driverRef.get();

    if (!snapshot.exists) {
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
      serializeDriver(
        snapshot.id,
        snapshot.data() ?? {}
      );

    return NextResponse.json(
      {
        success: true,
        driver,
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
      "讀取司機資料失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "讀取司機資料失敗",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
 * PATCH
 *
 * 修改司機
 *
 * PATCH /api/drivers/xxxxx
 *
 * 可以只傳想修改的欄位
 * =======================================================*/

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id } =
      await context.params;

    const driverId =
      decodeURIComponent(
        id
      ).trim();

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

    /* -----------------------------------------------------
     * 讀 body
     * ---------------------------------------------------*/

    let body: DriverUpdateBody;

    try {
      body =
        (await request.json()) as DriverUpdateBody;
    } catch {
      return NextResponse.json(
        {
          success: false,
          message:
            "資料格式錯誤",
        },
        {
          status: 400,
        }
      );
    }

    /* -----------------------------------------------------
     * 確認司機存在
     * ---------------------------------------------------*/

    const driverRef =
      adminDb
        .collection("drivers")
        .doc(driverId);

    const oldSnapshot =
      await driverRef.get();

    if (!oldSnapshot.exists) {
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

    const oldData =
      oldSnapshot.data() ?? {};

    /* -----------------------------------------------------
     * 建立更新資料
     * ---------------------------------------------------*/

    const updateData: Record<
      string,
      unknown
    > = {};

    /* =========================
     * 司機名稱
     * =======================*/

    if (
      body.name !== undefined
    ) {
      const name =
        cleanString(body.name);

      if (!name) {
        return NextResponse.json(
          {
            success: false,
            message:
              "司機名稱不可空白",
          },
          {
            status: 400,
          }
        );
      }

      updateData.name =
        name;
    }

    /* =========================
     * 車牌
     * =======================*/

    if (
      body.plate !== undefined
    ) {
      updateData.plate =
        cleanString(
          body.plate
        ).toUpperCase();
    }

    /* =========================
     * 電話
     * =======================*/

    if (
      body.phone !== undefined
    ) {
      updateData.phone =
        cleanString(
          body.phone
        );
    }

    /* =========================
     * 狀態
     * =======================*/

    if (
      body.status !== undefined
    ) {
      if (
        !isValidStatus(
          body.status
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "司機狀態錯誤",
          },
          {
            status: 400,
          }
        );
      }

      updateData.status =
        body.status;

      /*
       * 只有真的改變狀態，
       * 才更新狀態時間。
       */
      if (
        oldData.status !==
        body.status
      ) {
        updateData.statusChangedAt =
          new Date();
      }
    }

    /* =========================
     * 月費方案
     * =======================*/

    if (
      body.plan !== undefined
    ) {
      if (
        !isValidPlan(
          body.plan
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "司機方案錯誤",
          },
          {
            status: 400,
          }
        );
      }

      updateData.plan =
        body.plan;
    }

    /* =========================
     * 月費
     * =======================*/

    if (
      body.monthlyFee !==
      undefined
    ) {
      const monthlyFee =
        parseMoney(
          body.monthlyFee
        );

      if (
        monthlyFee ===
        undefined
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "月費格式錯誤",
          },
          {
            status: 400,
          }
        );
      }

      updateData.monthlyFee =
        monthlyFee;
    }

    /* =========================
     * 入會費
     * =======================*/

    if (
      body.joinFee !==
      undefined
    ) {
      const joinFee =
        parseMoney(
          body.joinFee
        );

      if (
        joinFee ===
        undefined
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "入會費格式錯誤",
          },
          {
            status: 400,
          }
        );
      }

      updateData.joinFee =
        joinFee;
    }

    /* =========================
     * 繳費方式
     * =======================*/

    if (
      body.paymentMethod !==
      undefined
    ) {
      updateData.paymentMethod =
        cleanString(
          body.paymentMethod
        );
    }

    /* =========================
     * 是否繳交
     * =======================*/

    if (
      body.paid !== undefined
    ) {
      if (
        typeof body.paid !==
        "boolean"
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "paid 必須是 true 或 false",
          },
          {
            status: 400,
          }
        );
      }

      updateData.paid =
        body.paid;
    }

    /* =========================
     * 備註
     * =======================*/

    if (
      body.note !== undefined
    ) {
      updateData.note =
        cleanString(
          body.note
        );
    }

    /* =========================
     * 加入日期
     * =======================*/

    if (
      body.joinedAt !== undefined
    ) {
      if (
        body.joinedAt === null ||
        body.joinedAt === ""
      ) {
        updateData.joinedAt =
          null;
      } else {
        const date =
          new Date(
            body.joinedAt
          );

        if (
          Number.isNaN(
            date.getTime()
          )
        ) {
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

        updateData.joinedAt =
          date;
      }
    }

    /* -----------------------------------------------------
     * 沒有資料要更新
     * ---------------------------------------------------*/

    if (
      Object.keys(
        updateData
      ).length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "沒有需要更新的資料",
        },
        {
          status: 400,
        }
      );
    }

    /* -----------------------------------------------------
     * 更新時間
     * ---------------------------------------------------*/

    updateData.updatedAt =
      new Date();

    /* -----------------------------------------------------
     * 寫入 Firestore
     * ---------------------------------------------------*/

    await driverRef.update(
      updateData
    );

    /* -----------------------------------------------------
     * 再讀一次
     * ---------------------------------------------------*/

    const newSnapshot =
      await driverRef.get();

    const driver =
      serializeDriver(
        newSnapshot.id,
        newSnapshot.data() ?? {}
      );

    return NextResponse.json(
      {
        success: true,

        message:
          "司機資料更新成功",

        driver,
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
      "修改司機資料失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "修改司機資料失敗",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
 * DELETE
 *
 * 刪除司機
 *
 * DELETE /api/drivers/xxxxx
 *
 * 注意：
 * 正常司機不跑了，建議使用 inactive。
 * DELETE 是真正永久刪除 Firestore 文件。
 * =======================================================*/

export async function DELETE(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id } =
      await context.params;

    const driverId =
      decodeURIComponent(
        id
      ).trim();

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
        .collection("drivers")
        .doc(driverId);

    const snapshot =
      await driverRef.get();

    if (!snapshot.exists) {
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

    const driverData =
      snapshot.data() ?? {};

    /*
     * 保留刪除紀錄。
     *
     * 這樣就算真的刪除司機，
     * 未來還能查到誰被刪除。
     */
    await adminDb
      .collection(
        "driverDeletionLogs"
      )
      .add({
        driverId,

        driverName:
          typeof driverData.name ===
          "string"
            ? driverData.name
            : "",

        plate:
          typeof driverData.plate ===
          "string"
            ? driverData.plate
            : "",

        data:
          driverData,

        deletedAt:
          new Date(),
      });

    /*
     * 真正刪除司機
     */
    await driverRef.delete();

    return NextResponse.json(
      {
        success: true,

        id: driverId,

        message:
          "司機資料已刪除",
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
      "刪除司機資料失敗：",
      error
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "刪除司機資料失敗",
      },
      {
        status: 500,
      }
    );
  }
}