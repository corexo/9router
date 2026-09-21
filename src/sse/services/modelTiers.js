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
