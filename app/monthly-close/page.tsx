import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-session";
import MonthlyCloseClient from "./client";

export const dynamic = "force-dynamic";

export default async function MonthlyClosePage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin-login");
  return <MonthlyCloseClient />;
}
