import { NextResponse } from "next/server";
import { getUsageStats, getCockpitData } from "@/lib/usageDb";
import { getModelHealth } from "@/lib/modelHealth";

export const dynamic = "force-dynamic";

/**
 * GET /api/widgets — aggregated, read-only widget data for local dashboards
 * (Obsidian canvas iframes). Explicitly public by user choice; it returns
 * aggregate usage only and never credentials or provider tokens.
 */
export async function GET() {
  try {
    const [usage, cockpit, health] = await Promise.all([
      getUsageStats("24h"),
      getCockpitData("24h").catch(() => null),
      getModelHealth(),
    ]);
    return NextResponse.json({
      usage: {
        totalRequests: usage.totalRequests,
        totalPromptTokens: usage.totalPromptTokens,
        totalCompletionTokens: usage.totalCompletionTokens,
        totalCachedTokens: usage.totalCachedTokens,
        totalCost: usage.totalCost,
        byProvider: usage.byProvider,
        byModel: usage.byModel,
      },
      kpis: cockpit?.kpis ?? null,
      accounts: cockpit?.accounts ?? [],
      activeSessions: cockpit?.sessions?.active ?? [],
      health: Object.entries(health).map(([id, h]) => ({ id, ...h })),
    });
  } catch (error) {
    console.error("[API] Widgets data failed:", error);
    return NextResponse.json({ error: "Widgets data unavailable" }, { status: 500 });
  }
}
