import { randomBytes } from "node:crypto";
import { getSessionModel } from "./sessionModels.js";

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

// Provider families with prompt-cache support (ChatGPT/Codex via prompt_cache_key,
// GLM via prefix cache, Claude via cache_control anchoring).
const PROMPT_CACHE_PROVIDERS = new Set([
  "codex", "chatgpt",
  "glm", "glm-cn", "zai",
  "anthropic", "claude",
]);

export function supportsPromptCache(provider) {
  return PROMPT_CACHE_PROVIDERS.has(provider);
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
    if (isExpired(entry)) sessions.delete(key);
  }
}

function createEntry() {
  return {
    id: randomBytes(8).toString("hex"),
    requests: 0,
    models: [],
    providers: [],
    cachedTokens: 0,
    promptTokens: 0,
    cacheCapableSeen: false,
    cacheFlagged: false,
    createdAt: Date.now(),
    lastActive: Date.now(),
    turns: [],
  };
}

/**
 * Record one request for a session. Returns the opaque cache id (or null when
 * no usable session key). Numbers <= 0 are ignored so callers can pass rough
 * or missing estimates safely.
 */
export function touchSessionCache(sessionKey, { model, provider, cachedTokens, promptTokens, cacheActive } = {}) {
  if (!sessionKey) return null;
  const sessions = store();
  let entry = sessions.get(sessionKey);
  if (!entry || isExpired(entry)) {
    sessions.delete(sessionKey);
    entry = createEntry();
    sessions.set(sessionKey, entry);
    // Map preserves insertion order, so the oldest entry is the first key.
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }
  entry.requests += 1;
  entry.lastActive = Date.now();
  if (typeof model === "string" && model && !entry.models.includes(model)) entry.models.push(model);
  if (typeof provider === "string" && provider) {
    if (!entry.providers.includes(provider)) entry.providers.push(provider);
    if (supportsPromptCache(provider)) entry.cacheCapableSeen = true;
  }
  if (Number(cachedTokens) > 0) entry.cachedTokens += Number(cachedTokens);
  if (Number(promptTokens) > 0) entry.promptTokens += Number(promptTokens);
  if (cacheActive) entry.cacheFlagged = true;

  if (!entry.turns) entry.turns = [];
  entry.turns.unshift({
    timestamp: new Date().toISOString(),
    model: model || null,
    provider: provider || null,
    promptTokens: Number(promptTokens) || 0,
    cachedTokens: Number(cachedTokens) || 0,
    cacheActive: !!cacheActive,
  });
  if (entry.turns.length > 50) entry.turns.pop();

  return entry.id;
}

function toPublicEntry(entry) {
  return {
    cacheId: entry.id,
    state: Date.now() - entry.lastActive < ACTIVE_WINDOW_MS ? "active" : "idle",
    models: [...entry.models],
    providers: [...entry.providers],
    cachedTokens: entry.cachedTokens,
    promptTokens: entry.promptTokens,
    requests: entry.requests,
    cacheActive: entry.cacheFlagged || (entry.cachedTokens > 0 && entry.cacheCapableSeen),
    lastActive: new Date(entry.lastActive).toISOString(),
    createdAt: new Date(entry.createdAt).toISOString(),
  };
}

/** Dashboard list, oldest activity first (callers usually sort desc). */
export function getSessionCacheSnapshot() {
  const sessions = store();
  pruneExpired(sessions);
  return [...sessions.values()].map(toPublicEntry);
}

export function getSessionCacheById(id) {
  if (!id) return null;
  const sessions = store();
  pruneExpired(sessions);
  const entry = [...sessions.values()].find((candidate) => candidate.id === id);
  return entry ? toPublicEntry(entry) : null;
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
    if (entry.models.includes(model)) sessions.delete(key);
  }
}

/** Test/reset helper. */
export function clearSessionCache() {
  store().clear();
}
