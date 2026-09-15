import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    return NextResponse.json({
      success: true,
      months,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        message: "讀取歷史報表失敗",
      },
      {
        status: 500,
      }
    );
  }
}