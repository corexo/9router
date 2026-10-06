import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getJevStats } from "@/lib/db/repos/usageRepo.js";

export async function GET(request) {
  const period = new URL(request.url).searchParams.get("period") || "7d";
  const claims = await verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null);
  const ownerUsername = claims?.role === "moderator" ? claims.username : null;
  return NextResponse.json(await getJevStats(period, ownerUsername));
}
