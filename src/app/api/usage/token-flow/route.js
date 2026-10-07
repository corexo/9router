import { NextResponse } from "next/server";
import { getTokenFlowData } from "@/lib/usageDb";
import { getRequestUsername } from "@/lib/auth/requestUser";

const VALID_RANGES = new Set(["1h", "3h", "6h", "12h", "24h", "3d"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || "1h";

    if (!VALID_RANGES.has(range)) {
      return NextResponse.json({ error: "Invalid range. Valid: 1h, 3h, 6h, 12h, 24h, 3d" }, { status: 400 });
    }

    const data = await getTokenFlowData(range, await getRequestUsername());
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get token flow data:", error);
    return NextResponse.json({ error: "Failed to fetch token flow data" }, { status: 500 });
  }
}
