import { getMeta, setMeta } from "@/lib/db/helpers/metaStore.js";

const META_KEY = "modelHealthRegistry";
const TEMPORARY_COOLDOWN_MS = 30 * 60 * 1000;
const DAILY_FAILURE_THRESHOLD = 3;
const DAILY_DISABLE_MS = 24 * 60 * 60 * 1000;

/**
 * Classify an upstream failure into a health-policy decision.
 * - permanent: model is gone from the provider (auto-disable)
 * - capability: request schema not supported by this model
 * - cooldown: transient provider error (429/5xx/timeout)
 * - request: blame this request only, model stays untouched
 */
export function classifyModelFailure(status, message = "") {
  const text = String(message).toLowerCase();
  
  // Missing or retired models cannot recover without a catalog/configuration change.
  if (status === 404 || status === 410 || text.includes("model not found") || text.includes("model not exist") || text.includes("model has been deprecated") || text.includes("was deprecated")) {
    return { type: "unsupported", scope: "permanent" };
  }
  
  // Account-specific Codex rejection must not disable the model for other accounts.
  if (text.includes("not supported when using codex with a chatgpt account")) {
    return { type: "unsupported", scope: "request" };
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
  
  // Hard upstream prompt cap (e.g. copilot gpt-4o-mini enforces 12288): the model
  // can never serve this session size, and Jev keeps re-picking it (cheapest).
  // Block it in the pool (capability → state "incompatible") until manually reset.
  if (text.includes("model_max_prompt_tokens_exceeded") || /prompt token count of \d+ exceeds the limit of \d+/.test(text)) {
    return { type: "context_limit", scope: "capability" };
  }

  // Context overflow belongs to this request, not the model or other sessions.
  if (
    status === 413 ||
    text.includes("context window limit") ||
    text.includes("exceeds the context window") ||
    text.includes("exceeded this model context") ||
    text.includes("context length") ||
    text.includes("too many tokens") ||
    (text.includes("token") && (text.includes("exceed") || text.includes("exceeds")))
  ) {
    return { type: "context_limit", scope: "request" };
  }
  
  // Schema incompatibility
  if (text.includes("bad input") || text.includes("oneof") || text.includes("type mismatch") || text.includes("'prompt'")) {
    return { type: "incompatible", scope: "capability" };
  }
  
  // Repeated upstream/service failures can indicate a broken model route.
  if (status >= 500 || status === 408 || text.includes("timeout") || text.includes("timed out")) {
    return { type: "temporary", scope: "counted" };
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
  const sameDay = previous.failureDay === new Date(now).toISOString().slice(0, 10);
  const failuresToday = classification.scope === "counted" ? (sameDay ? previous.failuresToday || 0 : 0) + 1 : (previous.failures || 0) + 1;
  const disabledForDay = classification.scope === "counted" && failuresToday >= DAILY_FAILURE_THRESHOLD;
  const state = classification.scope === "permanent" || disabledForDay ? "disabled"
    : classification.scope === "capability" ? "incompatible"
    : classification.scope === "counted" ? "cooldown"
    : "cooldown";
  return {
    provider,
    model,
    connectionId: connectionId || previous.connectionId,
    state,
    reason: disabledForDay ? "repeated_upstream_errors" : classification.type,
    message: String(message || "").slice(0, 500),
    failures: (previous.failures || 0) + 1,
    failuresToday,
    failureDay: new Date(now).toISOString().slice(0, 10),
    updatedAt: new Date(now).toISOString(),
    expiresAt: disabledForDay ? new Date(now + DAILY_DISABLE_MS).toISOString()
      : classification.scope === "cooldown" || classification.scope === "counted" ? new Date(now + TEMPORARY_COOLDOWN_MS).toISOString()
      : null,
  };
}

/** Record an upstream failure. Never throws (health tracking must not break routing). */
export async function recordModelFailure({ provider, model, connectionId, status, message }) {
  try {
    const classification = classifyModelFailure(status, message);
    if (classification.scope === "request") return classification;

    const registry = await readRegistry();
    const key = `${provider}/${model}`;
    const previous = registry[key] || {};
    const next = entryFor(classification, previous, { provider, model, connectionId, message });
    if (classification.scope === "counted" && next.failuresToday < DAILY_FAILURE_THRESHOLD && previous.expiresAt && new Date(previous.expiresAt).getTime() > Date.now()) {
      next.expiresAt = previous.expiresAt;
    }
    registry[key] = next;
    await writeRegistry(registry);
    return { ...classification, disabledForDay: next.state === "disabled", failuresToday: next.failuresToday };
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
    if (item.failureDay && item.failureDay !== new Date(now).toISOString().slice(0, 10) && item.reason === "repeated_upstream_errors") {
      delete registry[key];
      changed = true;
      continue;
    }
    if ((item.state === "cooldown" || item.state === "disabled") && item.expiresAt && new Date(item.expiresAt).getTime() <= now) {
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
