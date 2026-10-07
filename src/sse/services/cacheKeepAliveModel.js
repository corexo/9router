const CONTEXT_SAFETY_TOKENS = 1_000;
export const CACHE_KEEPALIVE_MODEL_BLACKLIST = new Set(["gpt-5.4"]);

export function isCacheKeepAliveModelBlacklisted(model) {
  const canonical = String(model || "").split("/").at(-1).toLowerCase();
  return CACHE_KEEPALIVE_MODEL_BLACKLIST.has(canonical);
}

export function chooseSmallestContextModel(models, estimatedTokens) {
  const required = Math.max(0, Number(estimatedTokens) || 0) + CONTEXT_SAFETY_TOKENS;
  return models
    .filter((candidate) => !isCacheKeepAliveModelBlacklisted(candidate.model))
    .filter((candidate) => Number(candidate.contextWindow) >= required)
    .sort((a, b) => Number(a.contextWindow) - Number(b.contextWindow)
      || Number(/-review$/i.test(a.model)) - Number(/-review$/i.test(b.model))
      || a.model.localeCompare(b.model))[0] || null;
}
