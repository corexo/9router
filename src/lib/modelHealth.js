import { getMeta, setMeta } from "@/lib/db/helpers/metaStore.js";

const META_KEY = "modelHealthRegistry";
const TEMPORARY_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Classify an upstream failure into a health-policy decision.
 * - permanent: model is gone from the provider (auto-disable)
 * - capability: request schema not supported by this model
 * - cooldown: transient provider error (429/5xx/timeout)
 * - request: blame this request only, model stays untouched
 */
export function classifyModelFailure(status, message = "") {
  const text = String(message).toLowerCase();
  if (text.includes("model_not_supported") || text.includes("model not supported") || text.includes("model not found") || text.includes("does not exist")) {
    return { type: "unsupported", scope: "permanent" };
  }
  // Context overflow (incl. Cloudflare 413 / code 5021): blame the request, not the
  // model — it works fine for smaller payloads, so never cool it down globally.
  if (
    status === 413 ||
    text.includes("context window limit") ||
    text.includes("context length") ||
    text.includes("too many tokens") ||
    (text.includes("token") && (text.includes("exceed") || text.includes("exceeds")))
  ) {
    return { type: "context_limit", scope: "request" };
  }
  if (text.includes("bad input") || text.includes("oneof") || text.includes("type mismatch") || text.includes("'prompt'")) {
    return { type: "incompatible", scope: "capability" };
  }
  if (status === 429 || status >= 500 || text.includes("timeout") || text.includes("timed out")) {
    return { type: status === 429 ? "rate_limit" : "temporary", scope: "cooldown" };
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
