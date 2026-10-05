import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIER_PREFERENCE,
  TIER_PREFERENCES,
  filterModelsByTierPreference,
  getModelTier,
  getTierPreference,
  normalizeTierPreference,
} from "../../src/sse/services/modelTiers.js";

const POOL = [
  "cc/claude-opus-5",       // frontier
  "cc/claude-fable-5-1",    // strong
  "glm/glm-5.1",            // strong
  "cc/claude-haiku-4-5",    // mid
  "glm/glm-4.7-flash",      // fast
  "custom/unknown-model",   // no tier
];

describe("model tier preference", () => {
  it("classifies the catalog", () => {
    expect(getModelTier("claude-opus-5")).toBe("frontier");
    expect(getModelTier("claude-fable-5-1")).toBe("strong");
    expect(getModelTier("glm-4.7-flash")).toBe("fast");
    expect(getModelTier("gpt-6-astra")).toBe("frontier");
    expect(getModelTier("gpt-6-sol")).toBe("strong");
    expect(getModelTier("gpt-6-luna")).toBe("fast");
    expect(getModelTier("unknown-model")).toBeNull();
  });

  it("applies a user-defined low tier to an exact model id", () => {
    expect(getModelTier("custom/unknown-model", { "custom/unknown-model": "low" })).toBe("low");
    expect(getModelTier("other/unknown-model", { "custom/unknown-model": "low" })).toBeNull();
    expect(getModelTier("cc/claude-opus-5", { "cc/claude-opus-5": "low" })).toBe("low");
  });

  it("normalizes preference ids and falls back to balanced", () => {
    expect(normalizeTierPreference(" MAX ")).toBe("max");
    expect(normalizeTierPreference("nope")).toBeNull();
    expect(normalizeTierPreference(undefined)).toBeNull();
    expect(getTierPreference("nope").id).toBe(DEFAULT_TIER_PREFERENCE);
    expect(TIER_PREFERENCES.map((p) => p.id)).toEqual(["fast", "eco", "balanced", "quality", "max"]);
  });

  it("keeps every candidate in the pool for every preference", () => {
    for (const preference of TIER_PREFERENCES) {
      const result = filterModelsByTierPreference(POOL, preference.id);
      expect(result.models).toEqual(POOL);
      expect(result.dropped).toBe(0);
      expect(result.applied).toBe(false);
    }
  });

  it("exposes tier preferences as hints instead of exclusions", () => {
    expect(filterModelsByTierPreference(POOL, "max").preference.hint).toContain("strongly prefer FRONTIER");
    expect(filterModelsByTierPreference(POOL, "eco").preference.hint).toContain("all model tiers remain available");
  });

  it("never empties the pool", () => {
    const result = filterModelsByTierPreference(["cc/claude-opus-5"], "fast");
    expect(result.applied).toBe(false);
    expect(result.models).toEqual(["cc/claude-opus-5"]);
  });
});
