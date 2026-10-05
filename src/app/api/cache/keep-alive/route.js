import { NextResponse } from "next/server";
import {
  setSessionKeepAlive,
  getTopSessions,
  getSessionCacheSnapshot,
} from "@/lib/jev/sessionCache.js";
import {
  getKeepAliveStats,
  runCacheKeepAliveTick,
} from "@/sse/services/cacheKeepAlive.js";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/cache/keep-alive
 * Returns:
 * - stats: global daemon telemetry & execution stats
 * - config: current settings (enabled, intervalSecs, maxSessions, maxIdleMins)
 * - topSessions: Top active sessions with TTL countdowns & keep-alive state
 */
export async function GET() {
  try {
    const settings = await getSettings();
    const stats = getKeepAliveStats();
    const topSessions = getTopSessions(6, "activity");

    return NextResponse.json({
      stats,
      config: {
        enabled: !!settings.cacheKeepAliveEnabled,
        intervalSecs: Number(settings.cacheKeepAliveIntervalSecs) || 240,
        maxSessions: Number(settings.cacheKeepAliveMaxSessions) || 20,
        maxIdleMins: Number(settings.cacheKeepAliveMaxIdleMins) || 45,
      },
      topSessions,
    });
  } catch (error) {
    console.error("[API] Error in GET /api/cache/keep-alive:", error);
    return NextResponse.json({ error: "Failed to fetch keep-alive status" }, { status: 500 });
  }
}

/**
 * POST /api/cache/keep-alive
 * Body actions:
 * - { action: "toggleSession", cacheId: string, enabled: boolean }
 * - { action: "updateConfig", config: { enabled, intervalSecs, maxSessions, maxIdleMins } }
 * - { action: "triggerNow" }
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (action === "toggleSession") {
      const { cacheId, enabled } = body;
      if (!cacheId) {
        return NextResponse.json({ error: "Missing cacheId" }, { status: 400 });
      }
      const success = setSessionKeepAlive(cacheId, !!enabled);
      return NextResponse.json({ success, cacheId, enabled: !!enabled });
    }

    if (action === "updateConfig") {
      const { config } = body;
      const updates = {};
      if (typeof config?.enabled === "boolean") updates.cacheKeepAliveEnabled = config.enabled;
      if (Number.isFinite(config?.intervalSecs)) updates.cacheKeepAliveIntervalSecs = Math.max(60, Number(config.intervalSecs));
      if (Number.isFinite(config?.maxSessions)) updates.cacheKeepAliveMaxSessions = Math.min(200, Math.max(1, Number(config.maxSessions)));
      if (Number.isFinite(config?.maxIdleMins)) updates.cacheKeepAliveMaxIdleMins = Math.max(5, Number(config.maxIdleMins));

      const updated = await updateSettings(updates);
      return NextResponse.json({
        success: true,
        config: {
          enabled: !!updated.cacheKeepAliveEnabled,
          intervalSecs: updated.cacheKeepAliveIntervalSecs,
          maxSessions: updated.cacheKeepAliveMaxSessions,
          maxIdleMins: updated.cacheKeepAliveMaxIdleMins,
        },
      });
    }

    if (action === "triggerNow") {
      // Non-blocking trigger of keep-alive tick
      runCacheKeepAliveTick().catch((err) => {
        console.error("[API] Manual keep-alive trigger error:", err);
      });
      return NextResponse.json({ success: true, message: "Keep-alive tick triggered" });
    }

    return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
  } catch (error) {
    console.error("[API] Error in POST /api/cache/keep-alive:", error);
    return NextResponse.json({ error: "Failed to process keep-alive action" }, { status: 500 });
  }
}
