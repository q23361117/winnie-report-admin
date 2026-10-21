import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getAdminSession } from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 兼容舊資料：原本的前端以 bindingStatus !== "bound" 計為待綁定。
 * 用整體數量減去已綁定數，可包含缺少 bindingStatus 的文件。
 * 聚合計數仍會消耗部分 Firestore 讀取額度，請避免高頻呼叫。
 */
export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: "管理員登入已失效，請重新登入。" },
        { status: 401 }
      );
    }

    const users = adminDb.collection("pendingLineUsers");
    const [totalSnapshot, boundSnapshot] = await Promise.all([
      users.count().get(),
      users.where("bindingStatus", "==", "bound").count().get(),
    ]);

    const totalCount = totalSnapshot.data().count;
    const boundCount = boundSnapshot.data().count;

    return NextResponse.json(
      {
        success: true,
        pendingCount: Math.max(0, totalCount - boundCount),
        totalCount,
        boundCount,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("LINE 待綁定人數統計失敗：", error);
    return NextResponse.json(
      { success: false, error: "讀取待綁定人數失敗，請檢查 Firestore 配額及伺服器紀錄。" },
      { status: 503 }
    );
  }
}
