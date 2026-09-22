import { NextResponse } from "next/server";
import { getCacheStats } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await getCacheStats(period);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get cache stats:", error);
    return NextResponse.json({ error: "Failed to fetch cache stats" }, { status: 500 });
  }
}
