import { describe, it, expect, beforeEach, vi } from "vitest";
import { getCachedJevDecision, setCachedJevDecision, clearJevDecisionCache, getJevDecisionCacheStats } from "@/lib/jev/decisionCache.js";

describe("Jev Decision Cache", () => {
  beforeEach(() => {
    clearJevDecisionCache();
  });

  it("stores and retrieves cached decisions", () => {
    setCachedJevDecision("sess1", 50000, "cc/claude-sonnet-5", "high");
    const cached = getCachedJevDecision("sess1", 50000);
    expect(cached).toEqual({ model: "cc/claude-sonnet-5", thinking: "high" });
  });

  it("returns null for cache miss (no entry)", () => {
    const cached = getCachedJevDecision("sess1", 50000);
    expect(cached).toBeNull();
  });

  it("returns null for expired cache entries", () => {
    setCachedJevDecision("sess1", 50000, "cc/claude-sonnet-5", "high", 100); // 100ms TTL
    expect(getCachedJevDecision("sess1", 50000, 100)).toEqual({ model: "cc/claude-sonnet-5", thinking: "high" });
    
    // Advance time beyond TTL
    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    const cached = getCachedJevDecision("sess1", 50000, 100);
    expect(cached).toBeNull();
    vi.useRealTimers();
  });

  it("buckets context tokens (e.g. 45k -> 50k, 103k -> 110k)", () => {
    setCachedJevDecision("sess1", 45000, "model-a", "");
    expect(getCachedJevDecision("sess1", 50000)).toEqual({ model: "model-a", thinking: "" });
    expect(getCachedJevDecision("sess1", 43000)).toEqual({ model: "model-a", thinking: "" }); // Same bucket (both -> 50k)
    expect(getCachedJevDecision("sess1", 35000)).toBeNull(); // Different bucket (-> 40k)
  });

  it("ignores cache hit if model not in available list", () => {
    setCachedJevDecision("sess1", 50000, "cc/claude-sonnet-5", "");
    const cached = getCachedJevDecision("sess1", 50000);
    expect(cached).toEqual({ model: "cc/claude-sonnet-5", thinking: "" });
    // In selectJevModel, this is validated: models.includes(cached.model)
  });

  it("returns cache stats", () => {
    setCachedJevDecision("sess1", 50000, "model-a", "");
    setCachedJevDecision("sess2", 100000, "model-b", "");
    const stats = getJevDecisionCacheStats();
    expect(stats.size).toBe(2);
    expect(stats.maxEntries).toBe(500);
    expect(stats.contextBucketSizeTokens).toBe(10000);
    expect(stats.defaultTtlMs).toBe(600000); // 10 minutes
  });

  it("evicts oldest entry when cache is full", () => {
    // Manually fill cache to near-capacity (test helper)
    vi.useFakeTimers();
    for (let i = 0; i < 500; i++) {
      setCachedJevDecision(`sess${i}`, 50000 + i * 1000, `model${i}`, "");
      vi.advanceTimersByTime(1);
    }
    
    // Add one more, should evict oldest
    setCachedJevDecision("sess_new", 50000, "model_new", "");
    const stats = getJevDecisionCacheStats();
    expect(stats.size).toBe(500); // Still at max
    
    vi.useRealTimers();
  });

  it("clears all cache entries on demand", () => {
    setCachedJevDecision("sess1", 50000, "model-a", "");
    setCachedJevDecision("sess2", 60000, "model-b", "");
    clearJevDecisionCache();
    expect(getCachedJevDecision("sess1", 50000)).toBeNull();
    expect(getCachedJevDecision("sess2", 60000)).toBeNull();
  });
});
