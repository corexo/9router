/**
 * Response cache — stores complete API responses locally
 * to reduce upstream calls for identical requests.
 * Cache key: SHA256(provider + model + normalized-messages)
 */

import crypto from "crypto";

// Simple in-memory cache (could upgrade to SQLite persisted cache later)
const memCache = new Map();
const MAX_CACHE_SIZE = 100; // Max number of cached responses

function hashRequest(provider, model, messages) {
  const normalized = {
    provider,
    model,
    msgs: (messages || []).map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    }))
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export function getCachedResponse(provider, model, messages) {
  const key = hashRequest(provider, model, messages);
  return memCache.get(key);
}

export function setCachedResponse(provider, model, messages, response) {
  const key = hashRequest(provider, model, messages);
  // Simple LRU eviction: remove oldest on overflow
  if (memCache.size >= MAX_CACHE_SIZE) {
    const firstKey = memCache.keys().next().value;
    memCache.delete(firstKey);
  }
  memCache.set(key, {
    response,
    cached_at: new Date().toISOString()
  });
}

export function clearResponseCache() {
  memCache.clear();
}

export function getResponseCacheStats() {
  return {
    size: memCache.size,
    max: MAX_CACHE_SIZE
  };
}
