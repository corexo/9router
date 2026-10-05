import { NextResponse } from "next/server";
import { getSessionCacheSnapshot } from "@/lib/jev/sessionCache.js";

export const dynamic = "force-dynamic";

/** Per-session cache observability snapshot (in-memory registry, newest first). */
export async function GET(request) {
  try {
    const showPath = request && new URL(request.url).searchParams.get("cockpit") === "true";
    const sessions = getSessionCacheSnapshot()
      .map(({ cacheId, state, models, providers, piProjectPath, cachedTokens, promptTokens, requests, cacheActive, lastActive }) => ({
        cacheId,
        state,
        models,
        provider: providers[0] || null,
        ...(showPath ? { piProjectPath: piProjectPath || null } : {}),
        cacheActive,
        cachedTokens,
        promptTokens,
        requests,
        lastActive,
      }))
      .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[API] Failed to get cache sessions:", error);
    return NextResponse.json({ error: "Failed to fetch cache sessions" }, { status: 500 });
  }
}
