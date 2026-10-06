import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { listLoginAudit } from "@/lib/db/repos/authAuditRepo.js";

export async function GET() {
  const claims = await verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null);
  if (!claims?.username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const entries = await listLoginAudit({ username: claims.role === "admin" ? null : claims.username, limit: 100 });
  return NextResponse.json({ entries });
}
