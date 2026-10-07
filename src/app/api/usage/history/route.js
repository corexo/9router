import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { getRequestUsername } from "@/lib/auth/requestUser";

export async function GET() {
  try {
    const stats = await getUsageStats("all", await getRequestUsername());
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
