import { NextResponse } from "next/server";
import { getSessionCacheSnapshot } from "@/lib/jev/sessionCache.js";

export const dynamic = "force-dynamic";

/** Per-session cache observability snapshot (in-memory registry, newest first). */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter");
    const showPath = searchParams.get("cockpit") === "true";

    let list = getSessionCacheSnapshot({ includeTurns: true });
    if (filter === "active") {
      list = list.filter((s) => s.state === "active");
    }

    const sessions = list
      .map(({
        cacheId,
        state,
        models,
        providers,
        connectionId,
        piProjectPath,
        cachedTokens,
        promptTokens,
        requests,
        cacheActive,
        keepAliveEnabled,
        keepAlivePingCount,
        lastKeepAliveAt,
        lastKeepAliveStatus,
        hasProbePrefix,
        ttlRemainingSecs,
        lastActive,
        createdAt,
        turns
      }) => ({
        cacheId,
        state,
        models,
        providers: providers || [],
        provider: providers?.[0] || null,
        connectionId: connectionId || null,
        piProjectPath: piProjectPath || null,
        cacheActive,
        cachedTokens,
        promptTokens,
        requests,
        keepAliveEnabled: !!keepAliveEnabled,
        keepAlivePingCount: keepAlivePingCount || 0,
        lastKeepAliveAt: lastKeepAliveAt || null,
        lastKeepAliveStatus: lastKeepAliveStatus || null,
        hasProbePrefix: !!hasProbePrefix,
        ttlRemainingSecs: ttlRemainingSecs ?? 0,
        lastActive,
        createdAt: createdAt || lastActive,
        turns: turns || [],
      }))
      .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[API] Failed to get cache sessions:", error);
    return NextResponse.json({ error: "Failed to fetch cache sessions" }, { status: 500 });
  }
}
