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
    expect(getModelTier("unknown-model")).toBeNull();
  });

  it("normalizes preference ids and falls back to balanced", () => {
    expect(normalizeTierPreference(" MAX ")).toBe("max");
    expect(normalizeTierPreference("nope")).toBeNull();
    expect(normalizeTierPreference(undefined)).toBeNull();
    expect(getTierPreference("nope").id).toBe(DEFAULT_TIER_PREFERENCE);
    expect(TIER_PREFERENCES.map((p) => p.id)).toEqual(["fast", "eco", "balanced", "quality", "max"]);
  });

  it("leaves the pool untouched in balanced mode", () => {
    const result = filterModelsByTierPreference(POOL, "balanced");
    expect(result.applied).toBe(false);
    expect(result.models).toEqual(POOL);
  });

  it("keeps only frontier models in max mode", () => {
    const result = filterModelsByTierPreference(POOL, "max");
    expect(result.applied).toBe(true);
    expect(result.models).toEqual(["cc/claude-opus-5"]);
    expect(result.dropped).toBe(5);
  });

  it("keeps strong and frontier in quality mode, drops unknown tiers", () => {
    const result = filterModelsByTierPreference(POOL, "quality");
    expect(result.models).toEqual(["cc/claude-opus-5", "cc/claude-fable-5-1", "glm/glm-5.1"]);
  });

  it("keeps fast and mid in eco mode", () => {
    const result = filterModelsByTierPreference(POOL, "eco");
    expect(result.models).toEqual(["cc/claude-haiku-4-5", "glm/glm-4.7-flash"]);
  });

  it("never empties the pool", () => {
    const result = filterModelsByTierPreference(["cc/claude-opus-5"], "fast");
    expect(result.applied).toBe(false);
    expect(result.models).toEqual(["cc/claude-opus-5"]);
  });
});
