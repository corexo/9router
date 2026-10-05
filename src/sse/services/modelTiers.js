/**
 * Quality tiers for Jev candidate criteria.
 *
 * 9Router has no measured per-model quality signal (usageRepo records no success
 * field), so Jev previously only saw model-name strings and kept picking Claude.
 * These tiers tell Jev which models are actually equivalent in strength, e.g.
 * claude-opus-5, gpt-6-astra and glm-5.3 all being frontier-grade.
 *
 * ponytail: hand-maintained catalog, matched by bare model name (longest prefix
 * wins). Upgrade path: derive tiers from real benchmark/success telemetry once
 * per-model outcome tracking exists.
 */

export const TIER_DESCRIPTIONS = {
  low: "Low tier — minimal capability, suitable only for simple tasks",
  frontier: "Frontier tier — strongest available, best for hard reasoning, architecture and multi-file work",
  strong: "Strong tier — very capable general-purpose model, handles most complex coding tasks",
  mid: "Mid tier — solid for routine coding, refactors and well-defined tasks",
  fast: "Fast tier — small/cheap model, best for trivial edits, lookups and short answers",
};

// Bare model name prefixes -> tier. Longest matching prefix wins.
const TIER_PREFIXES = [
  // frontier
  ["claude-opus-5", "frontier"],
  // fable is cheaper than opus at the same tier, which made Jev pick it for
  // trivial follow-ups ("ja", "weiter"); it is strong, not opus-grade.
  ["claude-fable-5", "strong"],
  ["gpt-6-astra", "frontier"],
  ["gpt-6-sol", "strong"],
  ["gpt-6-luna", "fast"],
  ["gpt-6", "frontier"],
  ["glm-5.3", "frontier"],
  ["gemini-3.1-pro", "frontier"],
  ["gpt-5.6", "frontier"],
  // strong
  ["claude-sonnet-5", "strong"],
  ["glm-5.2", "strong"],
  ["glm-5.1", "strong"],
  ["glm-5", "strong"],
  ["gpt-5.4", "strong"],
  ["gpt-5.3", "strong"],
  ["gpt-5.2", "strong"],
  ["gemini-3", "strong"],
  ["qwq-32b", "strong"],
  ["minimax-m3", "strong"],
  ["kimi-k2", "strong"],
  // mid
  ["claude-haiku", "mid"],
  ["glm-4.7", "mid"],
  ["glm-4.6", "mid"],
  ["qwen3", "mid"],
  ["minimax-m2", "mid"],
  ["deepseek-r1", "mid"],
  ["gpt-oss", "mid"],
  ["gemma", "mid"],
  ["mimo", "mid"],
  // fast
  ["glm-4.7-flash", "fast"],
  ["glm-5.3-flash", "fast"],
  ["gpt-5.4-mini", "fast"],
  ["gpt-4o-mini", "fast"],
  ["llama-3.2-1b", "fast"],
  ["llama-3.2-3b", "fast"],
  ["qwen3.8-flash", "fast"],
  ["qwen3-flash", "fast"],
];

/** Returns a quality tier (including user-defined low) or null for a bare model name. */
export function getModelTier(bareModel, overrides = {}) {
  if (!bareModel) return null;
  const normalized = String(bareModel).toLowerCase();
  const override = Object.entries(overrides || {}).find(([id]) => id.toLowerCase() === normalized);
  if (override && ["low", "fast", "mid", "strong", "frontier"].includes(override[1])) return override[1];
  const name = normalized.replace(/^@cf\//, "").split("/").pop();
  let best = null;
  for (const [prefix, tier] of TIER_PREFIXES) {
    if (name.includes(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, tier];
  }
  return best ? best[1] : null;
}

/**
 * User-controlled tier preference ("Modell-Klasse" slider in the dashboard).
 *
 * Preferences express a soft routing bias. They never reduce the candidate pool;
 * the hint is appended to Jev's instructions while every eligible model remains available.
 */
export const TIER_PREFERENCES = [
  {
    id: "fast",
    label: "Nur kleine Modelle",
    tiers: ["fast"],
    hint: "User preference: strongly prefer FAST/small models when suitable, but all model tiers remain available; use stronger models when the request needs them.",
  },
  {
    id: "eco",
    label: "Sparsam",
    tiers: ["fast", "mid"],
    hint: "User preference: prefer FAST and MID models for suitable requests to reduce cost; all model tiers remain available when the request needs them.",
  },
  {
    id: "balanced",
    label: "Ausgewogen",
    tiers: ["low", "fast", "mid", "strong", "frontier"],
    hint: "",
  },
  {
    id: "quality",
    label: "Starke Modelle",
    tiers: ["strong", "frontier"],
    hint: "User preference: lean toward STRONG and FRONTIER models when the request is non-trivial; all model tiers remain available for simple requests or better fit.",
  },
  {
    id: "max",
    label: "Nur Top-Modelle",
    tiers: ["frontier"],
    hint: "User preference: strongly prefer FRONTIER models for complex work; all model tiers remain available when the task does not require them.",
  },
];

export const DEFAULT_TIER_PREFERENCE = "balanced";

const PREFERENCE_BY_ID = new Map(TIER_PREFERENCES.map((preference) => [preference.id, preference]));

/** Returns the preference id if valid, otherwise null. */
export function normalizeTierPreference(value) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return PREFERENCE_BY_ID.has(id) ? id : null;
}

export function getTierPreference(value) {
  return PREFERENCE_BY_ID.get(normalizeTierPreference(value) || DEFAULT_TIER_PREFERENCE);
}

/** Keep every eligible model; tier preference only changes Jev's prompt hint. */
export function filterModelsByTierPreference(models, value) {
  return { models: Array.isArray(models) ? models : [], applied: false, preference: getTierPreference(value), dropped: 0 };
}

