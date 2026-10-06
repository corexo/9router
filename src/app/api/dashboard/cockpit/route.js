import { NextResponse } from "next/server";
import { getCockpitData } from "@/lib/usageDb";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const claims = await verifyDashboardAuthToken(cookieStore.get("auth_token")?.value);
    const ownerUsername = claims?.username || null;
    const data = await getCockpitData(period, ownerUsername);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get cockpit data:", error);
    return NextResponse.json({ error: "Failed to fetch cockpit data" }, { status: 500 });
  }
}
