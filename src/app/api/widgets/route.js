import { NextResponse } from "next/server";
import { getUsageStats, getCockpitData } from "@/lib/usageDb";
import { getModelHealth } from "@/lib/modelHealth";
import { getProviderConnections, hasUsers } from "@/lib/localDb";
import { getRequestUsername } from "@/lib/auth/requestUser";
import { extractApiKey } from "@/sse/services/auth.js";
import { validateApiKeyDetails } from "@/lib/db/repos/apiKeysRepo.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/widgets — aggregated, read-only widget data for local dashboards
 * (Obsidian canvas iframes). Explicitly public by user choice; it returns
 * aggregate usage only and never credentials or provider tokens.
 */
export async function GET(request) {
  try {
    const browserUser = await getRequestUsername();
    const key = browserUser ? null : extractApiKey(request);
    const keyDetails = key ? await validateApiKeyDetails(key) : null;
    const username = browserUser || keyDetails?.ownerUsername || null;
    if (await hasUsers() && !username) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const [usage, cockpit, health, connections] = await Promise.all([
      getUsageStats("24h", username),
      getCockpitData("24h", username).catch(() => null),
      getModelHealth(),
      username ? getProviderConnections({ ownerUsername: username }) : Promise.resolve([]),
    ]);
    const visibleProviders = new Set(connections.map((connection) => connection.provider));
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
      health: Object.entries(health)
        .filter(([id]) => !username || visibleProviders.has(id.split("/")[0]))
        .map(([id, h]) => ({ id, ...h })),
    });
  } catch (error) {
    console.error("[API] Widgets data failed:", error);
    return NextResponse.json({ error: "Widgets data unavailable" }, { status: 500 });
  }
}
