import { randomBytes } from "node:crypto";
import { getSessionModel, isSessionProviderPenalized } from "./sessionModels.js";

/**
 * Per-session cache observability registry.
 *
 * Tracks, for each client conversation (identified by the stable sessionKey from
 * sessionModels.js), an OPAQUE random id plus token/cache statistics. The id is
 * deliberately not derived from the session key hash — that would be derivable
 * from the prompt prefix, the random id is not.
 *
 * Store contains no prompt text and no credentials: only ids, model names,
 * provider names and token counters.
 *
 * Pinned on globalThis: Next.js bundles each route separately, so a
 * module-scoped Map would not be shared between the chat handler and the
 * dashboard API route.
 */

const STORE_KEY = Symbol.for("9router.sessionCache");
const MAX_SESSIONS = 200;
const TTL_MS = 2 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

let hydrationPromise = null;

function persistEntry(key, entry) {
  if (!key || !entry) return;
  Promise.resolve().then(async () => {
    try {
      const { makeKv } = await import("../db/helpers/kvStore.js");
      const kv = makeKv("sessionCache");
      await kv.set(key, entry);
    } catch {
      // Ignore if DB not ready or in test environment
    }
  });
}

function removePersistedEntry(key) {
  if (!key) return;
  Promise.resolve().then(async () => {
    try {
      const { makeKv } = await import("../db/helpers/kvStore.js");
      const kv = makeKv("sessionCache");
      await kv.remove(key);
    } catch {}
  });
}

export async function hydrateSessionCacheFromDb() {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      const { makeKv } = await import("../db/helpers/kvStore.js");
      const kv = makeKv("sessionCache");
      const all = await kv.getAll();
      const sessions = store();
      const now = Date.now();
      for (const [key, entry] of Object.entries(all || {})) {
        if (entry && typeof entry === "object" && entry.lastActive && (now - entry.lastActive <= TTL_MS)) {
          if (!sessions.has(key)) {
            sessions.set(key, entry);
          }
        } else if (entry && entry.lastActive) {
          kv.remove(key).catch(() => {});
        }
      }
    } catch {
      // DB not ready or not available
    }
  })();
  return hydrationPromise;
}

// Provider families with prompt-cache support (ChatGPT/Codex via prompt_cache_key,
// GLM via prefix cache, Claude via cache_control anchoring, Gemini via context cache).
const PROMPT_CACHE_PROVIDERS = new Set([
  "codex", "chatgpt", "openai",
  "glm", "glm-cn", "zai",
  "anthropic", "claude",
  "gemini", "deepseek", "qwen",
  "cloudflare-ai",
]);

const PROMPT_CACHE_EXCLUDED = new Set(["antigravity", "gemini-cli"]);

export function supportsPromptCache(provider) {
  if (!provider) return false;
  const p = String(provider).toLowerCase();
  if (PROMPT_CACHE_EXCLUDED.has(p)) return false;
  for (const known of PROMPT_CACHE_PROVIDERS) {
    if (p.includes(known)) return true;
  }
  return false;
}

function store() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = new Map();
  return globalThis[STORE_KEY];
}

function isExpired(entry) {
  return Date.now() - entry.lastActive > TTL_MS;
}

function pruneExpired(sessions) {
  for (const [key, entry] of sessions.entries()) {
    if (isExpired(entry)) {
      sessions.delete(key);
      removePersistedEntry(key);
    }
  }
}

function createEntry() {
  return {
    id: randomBytes(8).toString("hex"),
    requests: 0,
    models: [],
    providers: [],
    connectionId: null,
    cachedTokens: 0,
    promptTokens: 0,
    cacheCapableSeen: false,
    cacheFlagged: false,
    keepAliveEnabled: false,
    keepAlivePingCount: 0,
    lastKeepAliveAt: null,
    lastKeepAliveStatus: null,
    probePrefix: null, // { messages, model, provider } for cache keep-alive
    createdAt: Date.now(),
    lastActive: Date.now(),
    lastUserActive: Date.now(), // Keep-alive probes must not extend the real-user window.
    turns: [],
  };
}

/**
 * Record one request for a session. Returns the opaque cache id (or null when
 * no usable session key). Numbers <= 0 are ignored so callers can pass rough
 * or missing estimates safely.
 */
export function touchSessionCache(sessionKey, { model, provider, connectionId, cachedTokens, promptTokens, cacheActive, latencyMs, completionTokens, probePrefix } = {}) {
  if (!sessionKey) return null;
  const sessions = store();
  let entry = sessions.get(sessionKey);
  if (!entry || isExpired(entry)) {
    sessions.delete(sessionKey);
    entry = createEntry();
    sessions.set(sessionKey, entry);
    // Map preserves insertion order, so the oldest entry is the first key.
    while (sessions.size > MAX_SESSIONS) {
      const oldestKey = sessions.keys().next().value;
      sessions.delete(oldestKey);
      removePersistedEntry(oldestKey);
    }
  }
  entry.requests += 1;
  entry.lastActive = Date.now();
  entry.lastUserActive = entry.lastActive;
  if (typeof model === "string" && model && !entry.models.includes(model)) entry.models.push(model);
  if (typeof provider === "string" && provider) {
    if (!entry.providers.includes(provider)) entry.providers.push(provider);
    if (supportsPromptCache(provider)) entry.cacheCapableSeen = true;
  }
  if (Number(cachedTokens) > 0) entry.cachedTokens += Number(cachedTokens);
  if (Number(promptTokens) > 0) entry.promptTokens += Number(promptTokens);
  if (cacheActive) entry.cacheFlagged = true;
  if (connectionId) entry.connectionId = connectionId;
  if (probePrefix && Array.isArray(probePrefix.messages) && probePrefix.messages.length > 0) {
    entry.probePrefix = probePrefix;
  }

  if (!entry.turns) entry.turns = [];
  entry.turns.unshift({
    timestamp: new Date().toISOString(),
    model: model || null,
    provider: provider || null,
    promptTokens: Number(promptTokens) || 0,
    cachedTokens: Number(cachedTokens) || 0,
    cacheActive: !!cacheActive,
    latencyMs: Number(latencyMs) || null,
    completionTokens: Number(completionTokens) || null,
  });
  if (entry.turns.length > 50) entry.turns.pop();

  persistEntry(sessionKey, entry);
  return entry.id;
}

/**
 * Update the session cache with authoritative upstream token usage upon response completion.
 * Does NOT increment request count; updates existing turn or records cached/prompt tokens.
 */
export function updateSessionCacheUsage(sessionKey, { model, provider, cachedTokens, promptTokens, completionTokens, latencyMs, connectionId, probePrefix } = {}) {
  if (!sessionKey) return null;
  const sessions = store();
  let entry = sessions.get(sessionKey);
  if (!entry || isExpired(entry)) {
    sessions.delete(sessionKey);
    entry = createEntry();
    entry.requests = 1;
    sessions.set(sessionKey, entry);
    while (sessions.size > MAX_SESSIONS) {
      const oldestKey = sessions.keys().next().value;
      sessions.delete(oldestKey);
      removePersistedEntry(oldestKey);
    }
  }

  entry.lastActive = Date.now();
  entry.lastUserActive = entry.lastActive;
  if (typeof model === "string" && model && !entry.models.includes(model)) entry.models.push(model);
  if (typeof provider === "string" && provider) {
    if (!entry.providers.includes(provider)) entry.providers.push(provider);
    if (supportsPromptCache(provider)) entry.cacheCapableSeen = true;
  }
  if (connectionId) entry.connectionId = connectionId;
  if (probePrefix && Array.isArray(probePrefix.messages) && probePrefix.messages.length > 0) {
    entry.probePrefix = probePrefix;
  }

  const cachedNum = Number(cachedTokens) || 0;
  const promptNum = Number(promptTokens) || 0;

  if (cachedNum > 0) {
    entry.cachedTokens += cachedNum;
    entry.cacheFlagged = true;
    entry.cacheCapableSeen = true;
  }

  if (!entry.turns) entry.turns = [];
  if (entry.turns.length > 0) {
    const latestTurn = entry.turns[0];
    if (cachedNum > 0) {
      latestTurn.cachedTokens = cachedNum;
      latestTurn.cacheActive = true;
    }
    if (promptNum > 0) {
      const prevEst = latestTurn.promptTokens || 0;
      if (prevEst > 0 && entry.promptTokens >= prevEst) {
        entry.promptTokens = entry.promptTokens - prevEst + promptNum;
      } else if (entry.promptTokens === 0) {
        entry.promptTokens += promptNum;
      }
      latestTurn.promptTokens = promptNum;
    }
    if (model) latestTurn.model = model;
    if (provider) latestTurn.provider = provider;
    if (completionTokens != null) latestTurn.completionTokens = Number(completionTokens);
    if (latencyMs != null) latestTurn.latencyMs = Number(latencyMs);
  } else {
    if (promptNum > 0) entry.promptTokens += promptNum;
    entry.turns.unshift({
      timestamp: new Date().toISOString(),
      model: model || null,
      provider: provider || null,
      promptTokens: promptNum,
      cachedTokens: cachedNum,
      cacheActive: cachedNum > 0,
      completionTokens: completionTokens != null ? Number(completionTokens) : null,
      latencyMs: latencyMs != null ? Number(latencyMs) : null,
    });
  }

  persistEntry(sessionKey, entry);
  return entry.id;
}

function toPublicEntry(entry, includeTurns = false) {
  const now = Date.now();
  const timeSinceActive = now - entry.lastActive;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const ttlRemainingMs = Math.max(0, CACHE_TTL_MS - timeSinceActive);

  const base = {
    cacheId: entry.id,
    state: timeSinceActive < ACTIVE_WINDOW_MS ? "active" : "idle",
    models: [...entry.models],
    providers: [...entry.providers],
    connectionId: entry.connectionId || null,
    cachedTokens: entry.cachedTokens,
    promptTokens: entry.promptTokens,
    requests: entry.requests,
    cacheActive: entry.cacheFlagged || entry.cachedTokens > 0 || (entry.cachedTokens > 0 && entry.cacheCapableSeen),
    keepAliveEnabled: !!entry.keepAliveEnabled,
    keepAlivePingCount: Number(entry.keepAlivePingCount || 0),
    lastKeepAliveAt: entry.lastKeepAliveAt ? new Date(entry.lastKeepAliveAt).toISOString() : null,
    lastKeepAliveStatus: entry.lastKeepAliveStatus || null,
    hasProbePrefix: !!(entry.probePrefix && entry.probePrefix.messages?.length > 0),
    ttlRemainingSecs: Math.round(ttlRemainingMs / 1000),
    lastActive: new Date(entry.lastActive).toISOString(),
    createdAt: new Date(entry.createdAt).toISOString(),
  };
  if (includeTurns) {
    base.turns = (entry.turns || []).slice(0, 30);
  }
  return base;
}

/**
 * Get pinned connectionId for a sessionKey (session stickiness for caching).
 */
export function getSessionConnection(sessionKey) {
  if (!sessionKey) return null;
  const sessions = store();
  const entry = sessions.get(sessionKey);
  if (!entry || isExpired(entry)) return null;
  return entry.connectionId || null;
}

/**
 * Set pinned connectionId for a sessionKey.
 */
export function setSessionConnection(sessionKey, connectionId) {
  if (!sessionKey || !connectionId) return;
  const sessions = store();
  let entry = sessions.get(sessionKey);
  if (!entry || isExpired(entry)) {
    sessions.delete(sessionKey);
    entry = createEntry();
    sessions.set(sessionKey, entry);
    while (sessions.size > MAX_SESSIONS) {
      const oldestKey = sessions.keys().next().value;
      sessions.delete(oldestKey);
      removePersistedEntry(oldestKey);
    }
  }
  entry.connectionId = connectionId;
  persistEntry(sessionKey, entry);
}

/**
 * Clear pinned connectionId for a sessionKey (e.g. upon account failure).
 */
export function clearSessionConnection(sessionKey) {
  if (!sessionKey) return;
  const sessions = store();
  const entry = sessions.get(sessionKey);
  if (entry && entry.connectionId) {
    entry.connectionId = null;
    persistEntry(sessionKey, entry);
  }
}

/** Dashboard list, oldest activity first (callers usually sort desc). */
export function getSessionCacheSnapshot(options = {}) {
  const sessions = store();
  pruneExpired(sessions);
  const includeTurns = options.includeTurns ?? false;
  return [...sessions.values()].map((e) => toPublicEntry(e, includeTurns));
}

export function getSessionCacheById(id) {
  if (!id) return null;
  const sessions = store();
  pruneExpired(sessions);
  const entry = [...sessions.values()].find((candidate) => candidate.id === id);
  return entry ? toPublicEntry(entry, true) : null;
}

/** Full details of a session including turns and sticky model. */
export function getSessionCacheDetail(id) {
  if (!id) return null;
  const sessions = store();
  pruneExpired(sessions);
  for (const [key, entry] of sessions.entries()) {
    if (entry.id === id) {
      const publicBase = toPublicEntry(entry);
      const stickyModel = getSessionModel(key);
      return {
        ...publicBase,
        stickyModel: stickyModel || (entry.models.length > 0 ? entry.models[entry.models.length - 1] : null),
        turns: entry.turns || [],
      };
    }
  }
  return null;
}

/**
 * Compact metadata for the response injection (SSE comment / header).
 * Contains only the opaque id, the boolean flag and the last model name.
 */
export function getSessionCacheMeta(sessionKey) {
  if (!sessionKey) return null;
  const entry = store().get(sessionKey);
  if (!entry || isExpired(entry)) return null;
  return {
    cacheId: entry.id,
    cacheActive: entry.cacheFlagged || (entry.cachedTokens > 0 && entry.cacheCapableSeen),
    model: entry.models.length > 0 ? entry.models[entry.models.length - 1] : null,
  };
}

/** Drop sessions whose model list contains the given model (e.g. after 413 eviction). */
export function clearSessionCacheByModel(model) {
  if (!model) return;
  const sessions = store();
  for (const [key, entry] of sessions.entries()) {
    if (entry.models.includes(model)) {
      sessions.delete(key);
      removePersistedEntry(key);
    }
  }
}

/**
 * Toggle or set keep-alive state for a session by opaque cacheId or sessionKey.
 */
export function setSessionKeepAlive(idOrKey, enabled) {
  if (!idOrKey) return false;
  const sessions = store();
  let targetEntry = null;
  let targetKey = null;

  if (sessions.has(idOrKey)) {
    targetKey = idOrKey;
    targetEntry = sessions.get(idOrKey);
  } else {
    for (const [key, entry] of sessions.entries()) {
      if (entry.id === idOrKey) {
        targetKey = key;
        targetEntry = entry;
        break;
      }
    }
  }

  if (!targetEntry || !targetKey) return false;
  targetEntry.keepAliveEnabled = !!enabled;
  persistEntry(targetKey, targetEntry);
  return true;
}

/**
 * Record a probe result for a session (updates lastKeepAliveAt, keepAlivePingCount).
 */
export function recordKeepAliveResult(sessionKey, { success, cachedTokens, latencyMs, error } = {}) {
  if (!sessionKey) return;
  const sessions = store();
  const entry = sessions.get(sessionKey);
  if (!entry) return;

  entry.lastKeepAliveAt = Date.now();
  entry.lastKeepAliveStatus = success ? "ok" : (error || "failed");
  if (success) {
    entry.keepAlivePingCount = (entry.keepAlivePingCount || 0) + 1;
    // Keep-alive touched upstream cache, refresh lastActive so session stays warm
    entry.lastActive = Date.now();
    if (Number(cachedTokens) > 0) {
      entry.cachedTokens += Number(cachedTokens);
      entry.cacheFlagged = true;
    }
  }
  persistEntry(sessionKey, entry);
}

/**
 * Get Top Sessions ranked by activity/tokens.
 */
export function getTopSessions(limit = 5, criteria = "activity") {
  const sessions = store();
  pruneExpired(sessions);
  const list = [...sessions.values()];

  if (criteria === "tokens") {
    list.sort((a, b) => (b.cachedTokens + b.promptTokens) - (a.cachedTokens + a.promptTokens));
  } else if (criteria === "cached") {
    list.sort((a, b) => b.cachedTokens - a.cachedTokens);
  } else {
    // Default: requests count + recency
    list.sort((a, b) => {
      if (b.requests !== a.requests) return b.requests - a.requests;
      return b.lastActive - a.lastActive;
    });
  }

  return list.slice(0, limit).map((e) => toPublicEntry(e, false));
}

/**
 * Find session candidates that need a keep-alive probe right now.
 * Eligible:
 * - Idle between minIdleMs (default 3m 45s = 225_000ms) and maxIdleMs (default 4m 30s = 270_000ms, or up to 5m)
 * - Time since genuine user traffic < 45m for explicit sessions, 2h for Top N
 * - Either explicitly keepAliveEnabled === true OR in the Top N active sessions
 */
export function getKeepAliveCandidates({
  minIdleMs = 210_000, // 3m 30s
  maxIdleMs = 285_000, // 4m 45s (before 5m TTL expires)
  maxSessionWindowMs = 45 * 60 * 1000, // Explicit sessions: 45m without user activity
  topSessionWindowMs = 2 * 60 * 60 * 1000, // Top sessions: 2h without user activity
  topN = 20,
  globalEnabled = true,
} = {}) {
  if (!globalEnabled) return [];
  const sessions = store();
  pruneExpired(sessions);
  const now = Date.now();

  // Rank only sessions that can actually be probed; otherwise unusable entries
  // consume the Top N slots and eligible sessions never get warmed.
  const activeEntries = [...sessions.entries()]
    .filter(([_, entry]) => entry.probePrefix?.messages?.length > 0)
    .filter(([_, entry]) => now - (entry.lastUserActive ?? entry.createdAt) <= topSessionWindowMs)
    .sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0));

  const topKeys = new Set(activeEntries.slice(0, topN).map(([k]) => k));
  const candidates = [];

  for (const [key, entry] of sessions.entries()) {
    if (!entry.probePrefix || !entry.probePrefix.messages?.length) continue;

    const idleMs = now - entry.lastActive;
    const isTop = topKeys.has(key);
    const isExplicit = !!entry.keepAliveEnabled;

    if (!isTop && !isExplicit) continue;
    const userIdleMs = now - (entry.lastUserActive ?? entry.createdAt);
    if (userIdleMs > (isTop ? topSessionWindowMs : maxSessionWindowMs)) continue;

    // Skip if provider is currently penalized for this session (e.g. quota exhausted)
    const candidateProvider = entry.probePrefix.provider || (entry.probePrefix.model?.includes("/") ? entry.probePrefix.model.split("/")[0] : null);
    if (candidateProvider && isSessionProviderPenalized(key, candidateProvider)) {
      continue;
    }

    // Check if within keep-alive probe trigger window
    // Also avoid pinging more than once within 2 minutes
    const lastPingMs = entry.lastKeepAliveAt ? now - entry.lastKeepAliveAt : Infinity;
    if (idleMs >= minIdleMs && idleMs <= maxIdleMs && lastPingMs >= 120_000) {
      candidates.push({
        sessionKey: key,
        cacheId: entry.id,
        connectionId: entry.connectionId,
        models: entry.models,
        providers: entry.providers,
        probePrefix: entry.probePrefix,
        idleMs,
        isTop,
        isExplicit,
      });
    }
  }

  return candidates;
}

/** Test/reset helper. */
export function clearSessionCache() {
  hydrationPromise = null;
  store().clear();
}
