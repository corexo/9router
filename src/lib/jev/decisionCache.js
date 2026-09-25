/**
 * decisionCache.js
 *
 * Memoizes Jev model selection decisions per session + context-size bucket.
 * Avoids redundant API calls when session and token estimate stay within threshold.
 *
 * Cache key: sessionKey + tokenBucket (e.g. "sess123_50k")
 * TTL: configurable, default 10 minutes
 * Entry: { model, thinking, timestamp }
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CONTEXT_BUCKET_SIZE = 10000; // bucket by 10k tokens
const MAX_CACHE_ENTRIES = 500;

function store() {
  const key = Symbol.for("9router.jevDecisionCache");
  if (!globalThis[key]) {
    globalThis[key] = new Map(); // Map<cacheKey, { model, thinking, timestamp }>
  }
  return globalThis[key];
}

/**
 * Bucket context tokens into 10k-token ranges to tolerate small prompt variations.
 * E.g. 45,000 → "50k", 103,000 → "110k"
 */
function contextBucket(estimatedTokens) {
  if (!estimatedTokens || estimatedTokens < 0) return "0k";
  const bucket = Math.ceil(estimatedTokens / CONTEXT_BUCKET_SIZE) * CONTEXT_BUCKET_SIZE;
  return `${bucket / 1000}k`;
}

/**
 * Generate cache key from session ID and context size.
 */
function cacheKey(sessionId, estimatedTokens) {
  const bucket = contextBucket(estimatedTokens);
  return `${sessionId}_${bucket}`;
}

/**
 * Retrieve cached decision if valid (not expired, same bucket).
 * Returns { model, thinking } or null if miss.
 */
export function getCachedJevDecision(sessionId, estimatedTokens, ttlMs = DEFAULT_TTL_MS) {
  if (!sessionId) return null;

  const key = cacheKey(sessionId, estimatedTokens);
  const cache = store();
  const entry = cache.get(key);

  if (!entry) return null;

  const ageMs = Date.now() - entry.timestamp;
  if (ageMs > ttlMs) {
    cache.delete(key);
    return null;
  }

  return { model: entry.model, thinking: entry.thinking };
}

/**
 * Store a Jev decision in cache.
 */
export function setCachedJevDecision(sessionId, estimatedTokens, model, thinking, ttlMs = DEFAULT_TTL_MS) {
  if (!sessionId || !model) return;

  const key = cacheKey(sessionId, estimatedTokens);
  const cache = store();

  // Evict oldest entry if cache is full
  if (cache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of cache.entries()) {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(key, {
    model,
    thinking: thinking || "",
    timestamp: Date.now(),
  });
}

/**
 * Clear cached decisions for a specific model (e.g. after a 413 or error).
 */
export function clearCachedJevDecisionByModel(model) {
  if (!model) return;
  const cache = store();
  for (const [k, v] of cache.entries()) {
    if (v.model === model) cache.delete(k);
  }
}

/**
 * Clear all cached decisions (for testing or reset).
 */
export function clearJevDecisionCache() {
  store().clear();
}

/**
 * Get cache stats (for monitoring).
 */
export function getJevDecisionCacheStats() {
  const cache = store();
  return {
    size: cache.size,
    maxEntries: MAX_CACHE_ENTRIES,
    contextBucketSizeTokens: CONTEXT_BUCKET_SIZE,
    defaultTtlMs: DEFAULT_TTL_MS,
  };
}
