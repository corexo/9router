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

/** Returns "frontier" | "strong" | "mid" | "fast" | null for a bare model name. */
export function getModelTier(bareModel) {
  if (!bareModel) return null;
  const name = bareModel.toLowerCase().replace(/^@cf\//, "").split("/").pop();
  let best = null;
  for (const [prefix, tier] of TIER_PREFIXES) {
    if (name.includes(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, tier];
  }
  return best ? best[1] : null;
}

/**
 * User-controlled tier preference ("Modell-Klasse" slider in the dashboard).
 *
 * Ordered from cheapest/smallest to strongest. Each step restricts which tiers
 * Jev may choose from and carries a hint that is appended to Jev's instructions.
 * "balanced" is the neutral default: every tier stays available and Jev decides
 * purely from the request.
 */
export const TIER_PREFERENCES = [
  {
    id: "fast",
    label: "Nur kleine Modelle",
    tiers: ["fast"],
    hint: "User preference: ONLY small/fast models. Always pick the cheapest suitable model.",
  },
  {
    id: "eco",
    label: "Sparsam",
    tiers: ["fast", "mid"],
    hint: "User preference: economy mode. Prefer FAST and MID models; larger models are not offered.",
  },
  {
    id: "balanced",
    label: "Ausgewogen",
    tiers: ["fast", "mid", "strong", "frontier"],
    hint: "",
  },
  {
    id: "quality",
    label: "Starke Modelle",
    tiers: ["strong", "frontier"],
    hint: "User preference: quality mode. Only STRONG and FRONTIER models are offered; prefer the higher tier when the task is non-trivial.",
  },
  {
    id: "max",
    label: "Nur Top-Modelle",
    tiers: ["frontier"],
    hint: "User preference: maximum quality. Only FRONTIER models are offered; cost is not a concern.",
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

/**
 * Restrict Jev's candidate pool to the tiers a preference allows.
 *
 * - "balanced" (or an unknown value) leaves the pool untouched.
 * - Models whose tier is unknown are dropped in restricted modes so a
 *   "small models only" setting can never surface an unclassified frontier model.
 * - If the filter would empty the pool, the original pool is returned and
 *   `applied` is false: a preference must never break routing.
 *
 * bareModelOf: maps a candidate id ("cc/claude-opus-5") to its bare model name.
 */
export function filterModelsByTierPreference(models, value, bareModelOf = defaultBareModelOf) {
  const preference = getTierPreference(value);
  const input = Array.isArray(models) ? models : [];
  if (preference.id === DEFAULT_TIER_PREFERENCE) {
    return { models: input, applied: false, preference, dropped: 0 };
  }
  const allowed = new Set(preference.tiers);
  const kept = input.filter((modelId) => allowed.has(getModelTier(bareModelOf(modelId))));
  if (kept.length === 0) {
    return { models: input, applied: false, preference, dropped: 0 };
  }
  return { models: kept, applied: true, preference, dropped: input.length - kept.length };
}

function defaultBareModelOf(modelId) {
  const slash = String(modelId).indexOf("/");
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}
