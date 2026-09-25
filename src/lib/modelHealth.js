import { getMeta, setMeta } from "@/lib/db/helpers/metaStore.js";

const META_KEY = "modelHealthRegistry";
const TEMPORARY_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Classify an upstream failure into a health-policy decision.
 * - permanent: model is gone from the provider (auto-disable)
 * - capability: request schema not supported by this model
 * - cooldown: transient provider error (429/5xx/timeout)
 * - request: blame this request only, model stays untouched
 */
export function classifyModelFailure(status, message = "") {
  const text = String(message).toLowerCase();
  
  // 404 Not Found (e.g. Ollama model missing) → permanent disable
  if (status === 404 || text.includes("model not found") || text.includes("model not exist")) {
    return { type: "unsupported", scope: "permanent" };
  }
  
  // Model explicitly not supported by provider/account
  if (text.includes("model_not_supported") || text.includes("model not supported") || text.includes("does not exist")) {
    return { type: "unsupported", scope: "permanent" };
  }
  
  // 429 Quota/Rate limit → 30min cooldown
  if (status === 429 || text.includes("quota exceeded") || text.includes("resource_exhausted") || text.includes("rate limit exceeded")) {
    return { type: "rate_limit", scope: "cooldown" };
  }
  
  // GLM always requires thinking (cannot disable to none) → 30min cooldown
  if (text.includes("always engages in thinking") || text.includes("cannot be disabled")) {
    return { type: "incompatible", scope: "cooldown" };
  }
  
  // Context overflow: 413 / context window exceeded → 30min cooldown so Jev/combos don't keep looping on a model whose context is exceeded
  if (
    status === 413 ||
    text.includes("context window limit") ||
    text.includes("context length") ||
    text.includes("too many tokens") ||
    (text.includes("token") && (text.includes("exceed") || text.includes("exceeds")))
  ) {
    return { type: "context_limit", scope: "cooldown" };
  }
  
  // Schema incompatibility
  if (text.includes("bad input") || text.includes("oneof") || text.includes("type mismatch") || text.includes("'prompt'")) {
    return { type: "incompatible", scope: "capability" };
  }
  
  // 5xx server errors, timeouts
  if (status >= 500 || status === 408 || text.includes("timeout") || text.includes("timed out")) {
    return { type: "temporary", scope: "cooldown" };
  }
  
  return { type: "unknown", scope: "request" };
}

async function readRegistry() {
  try {
    return JSON.parse(await getMeta(META_KEY, "{}")) || {};
  } catch {
    return {};
  }
}

async function writeRegistry(registry) {
  await setMeta(META_KEY, JSON.stringify(registry));
}

function entryFor(classification, previous, { provider, model, connectionId, message }) {
  const now = Date.now();
  const state = classification.scope === "permanent" ? "disabled"
    : classification.scope === "capability" ? "incompatible"
    : "cooldown";
  return {
    provider,
    model,
    connectionId: connectionId || previous.connectionId,
    state,
    reason: classification.type,
    message: String(message || "").slice(0, 500),
    failures: (previous.failures || 0) + 1,
    updatedAt: new Date(now).toISOString(),
    expiresAt: classification.scope === "cooldown" ? new Date(now + TEMPORARY_COOLDOWN_MS).toISOString() : null,
  };
}

/** Record an upstream failure. Never throws (health tracking must not break routing). */
export async function recordModelFailure({ provider, model, connectionId, status, message }) {
  try {
    const classification = classifyModelFailure(status, message);
    if (classification.scope === "request") return classification;

    const registry = await readRegistry();
    const key = `${provider}/${model}`;
    registry[key] = entryFor(classification, registry[key] || {}, { provider, model, connectionId, message });
    await writeRegistry(registry);
    return classification;
  } catch {
    return { type: "tracking_error", scope: "request" };
  }
}

/** Clear any health entry after a successful request through this model. */
export async function recordModelSuccess(provider, model) {
  try {
    const registry = await readRegistry();
    const key = `${provider}/${model}`;
    if (!registry[key]) return;
    delete registry[key];
    await writeRegistry(registry);
  } catch {
    // ignore
  }
}

/** All currently blocked "provider/model" ids (expired cooldowns are pruned). */
export async function getUnavailableModelIds() {
  const registry = await readRegistry();
  const now = Date.now();
  const ids = new Set();
  let changed = false;
  for (const [key, item] of Object.entries(registry)) {
    if (item.state === "cooldown" && item.expiresAt && new Date(item.expiresAt).getTime() <= now) {
      delete registry[key];
      changed = true;
      continue;
    }
    ids.add(key);
  }
  if (changed) await writeRegistry(registry);
  return ids;
}

/** Full registry for the UI, with pruned cooldowns. */
export async function getModelHealth() {
  await getUnavailableModelIds();
  return readRegistry();
}

/** Manual or automated reset of one entry ("provider/model"). */
export async function resetModelHealth(modelId) {
  const registry = await readRegistry();
  delete registry[modelId];
  await writeRegistry(registry);
}

export const MODEL_HEALTH_COOLDOWN_MS = TEMPORARY_COOLDOWN_MS;
