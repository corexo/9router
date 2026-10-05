// Background Prompt Cache Keep-Alive daemon
// Proactively touches active sessions before upstream ephemeral cache (5m TTL) expires.
// Keeps KV-cache warm on Anthropic, OpenAI, GLM, etc., preventing expensive cold re-tokenization.

import * as log from "../utils/logger.js";
import { getKeepAliveCandidates, recordKeepAliveResult } from "../../lib/jev/sessionCache.js";
import { isSessionProviderPenalized } from "../../lib/jev/sessionModels.js";
import { getSettings } from "../../lib/db/repos/settingsRepo.js";
import { getProviderCredentials } from "./auth.js";
import { checkAndRefreshToken } from "./tokenRefresh.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";

let started = false;
let intervalHandle = null;
let tickRunning = false;

// Global stats tracker for dashboard
const KEEP_ALIVE_STATS = {
  startedAt: null,
  totalPings: 0,
  successfulPings: 0,
  failedPings: 0,
  tokensSavedEstimate: 0,
  lastTickAt: null,
  lastPingResults: [],
};

export function getKeepAliveStats() {
  return {
    ...KEEP_ALIVE_STATS,
    isRunning: started,
  };
}

/**
 * Execute a single keep-alive probe against upstream provider.
 * Uses exact pinned connection and identical model/prefix to preserve GPU cache shard.
 */
async function executeProbe(candidate) {
  const { sessionKey, cacheId, connectionId, probePrefix } = candidate;
  if (!probePrefix || !Array.isArray(probePrefix.messages) || probePrefix.messages.length === 0) {
    return { success: false, error: "no_probe_prefix" };
  }

  const modelStr = probePrefix.model;
  let provider = probePrefix.provider;
  let model = modelStr;

  if (modelStr && modelStr.includes("/")) {
    const parts = modelStr.split("/");
    provider = parts[0];
    model = parts.slice(1).join("/");
  }

  if (!provider) {
    return { success: false, error: "unknown_provider" };
  }

  if (sessionKey && isSessionProviderPenalized(sessionKey, provider)) {
    return { success: false, error: "provider_penalized_for_session" };
  }

  // Get credentials for this account (preferring pinned connectionId)
  const credentials = await getProviderCredentials(provider, null, model, {
    preferredConnectionId: connectionId || null,
  });

  if (!credentials || credentials.allRateLimited) {
    return { success: false, error: "credentials_unavailable" };
  }

  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

  // Build lightweight probe:
  // Re-use prefix messages + append a minimal 1-token trigger or probe instruction
  const probeMessages = [
    ...probePrefix.messages,
    { role: "user", content: "ping" },
  ];

  const probeBody = {
    model: `${provider}/${model}`,
    messages: probeMessages,
    max_tokens: 1,
    stream: false,
  };

  const startTime = Date.now();
  let cachedTokens = 0;

  try {
    const result = await handleChatCore({
      body: probeBody,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      connectionId: credentials.connectionId,
      userAgent: "9router-cache-keep-alive/1.0",
      apiKey: null,
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      pxpipeEnabled: false,
    });

    const latencyMs = Date.now() - startTime;

    if (result && result.success) {
      // Try to extract cached token count from response if available
      try {
        if (result.response && typeof result.response.clone === "function") {
          const clone = result.response.clone();
          const json = await clone.json();
          const usage = json?.usage;
          if (usage) {
            cachedTokens = usage.cached_tokens || usage.cache_read_input_tokens || usage.prompt_tokens_details?.cached_tokens || 0;
          }
        }
      } catch {}

      return {
        success: true,
        latencyMs,
        cachedTokens,
      };
    } else {
      return {
        success: false,
        latencyMs,
        error: result?.error || "chat_core_failure",
      };
    }
  } catch (err) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: err?.message || String(err),
    };
  }
}

/**
 * Execute one scheduled tick of Cache Keep-Alive daemon.
 */
export async function runCacheKeepAliveTick() {
  if (tickRunning) return;
  tickRunning = true;
  KEEP_ALIVE_STATS.lastTickAt = new Date().toISOString();

  try {
    const settings = await getSettings();
    if (!settings.cacheKeepAliveEnabled) {
      return;
    }

    const intervalSecs = Number(settings.cacheKeepAliveIntervalSecs) || 240;
    const maxSessions = Number(settings.cacheKeepAliveMaxSessions) || 20;
    const maxIdleMins = Number(settings.cacheKeepAliveMaxIdleMins) || 45;

    // Window: trigger probes between (intervalSecs - 30) and (intervalSecs + 30)
    const minIdleMs = Math.max(60_000, (intervalSecs - 30) * 1000);
    const maxIdleMs = (intervalSecs + 45) * 1000;
    const maxSessionWindowMs = maxIdleMins * 60 * 1000;

    const candidates = getKeepAliveCandidates({
      minIdleMs,
      maxIdleMs,
      maxSessionWindowMs,
      topN: maxSessions,
      globalEnabled: true,
    });

    if (candidates.length === 0) {
      return;
    }

    log.info("KEEP_ALIVE", `Running keep-alive for ${candidates.length} eligible session(s)...`);

    for (const candidate of candidates) {
      try {
        const probeRes = await executeProbe(candidate);

        recordKeepAliveResult(candidate.sessionKey, {
          success: probeRes.success,
          cachedTokens: probeRes.cachedTokens || 0,
          latencyMs: probeRes.latencyMs,
          error: probeRes.error,
        });

        KEEP_ALIVE_STATS.totalPings += 1;
        if (probeRes.success) {
          KEEP_ALIVE_STATS.successfulPings += 1;
          KEEP_ALIVE_STATS.tokensSavedEstimate += (probeRes.cachedTokens || 2000);
          log.info("KEEP_ALIVE", `✓ Probed session #${candidate.cacheId} (${candidate.probePrefix?.model || "unknown"}) in ${probeRes.latencyMs}ms (saved ~${probeRes.cachedTokens || 2000} tokens)`);
        } else {
          KEEP_ALIVE_STATS.failedPings += 1;
          log.warn("KEEP_ALIVE", `✗ Probe failed for #${candidate.cacheId}: ${probeRes.error}`);
        }

        // Store latest 20 results for UI inspection
        KEEP_ALIVE_STATS.lastPingResults.unshift({
          cacheId: candidate.cacheId,
          model: candidate.probePrefix?.model,
          provider: candidate.probePrefix?.provider,
          timestamp: new Date().toISOString(),
          success: probeRes.success,
          latencyMs: probeRes.latencyMs,
          cachedTokens: probeRes.cachedTokens || 0,
          error: probeRes.error || null,
        });
        if (KEEP_ALIVE_STATS.lastPingResults.length > 20) {
          KEEP_ALIVE_STATS.lastPingResults.pop();
        }

        // Small breather between probes
        await new Promise((res) => setTimeout(res, 800));
      } catch (sessionErr) {
        log.warn("KEEP_ALIVE", `Unexpected error during probe for #${candidate.cacheId}:`, sessionErr?.message || sessionErr);
      }
    }
  } catch (err) {
    log.warn("KEEP_ALIVE", "Keep-alive tick failed:", err?.message || err);
  } finally {
    tickRunning = false;
  }
}

/**
 * Start the Cache Keep-Alive daemon.
 */
export function startCacheKeepAlive({ checkIntervalMs = 30_000 } = {}) {
  if (started) return false;
  if (typeof window !== "undefined") return false;
  if (process.env.DISABLE_CACHE_KEEP_ALIVE === "true") return false;

  started = true;
  KEEP_ALIVE_STATS.startedAt = new Date().toISOString();

  // Run a scheduled tick every 30 seconds
  intervalHandle = setInterval(() => {
    runCacheKeepAliveTick().catch((err) => {
      log.warn("KEEP_ALIVE", "Interval tick error (swallowed):", err?.message || err);
    });
  }, checkIntervalMs);

  if (intervalHandle.unref) intervalHandle.unref();

  log.info("KEEP_ALIVE", "Prompt Cache Keep-Alive daemon started (interval check: 30s)");
  return true;
}

/**
 * Stop the Cache Keep-Alive daemon.
 */
export function stopCacheKeepAlive() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
  log.info("KEEP_ALIVE", "Prompt Cache Keep-Alive daemon stopped");
}
