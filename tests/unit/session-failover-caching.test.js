import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sessionKey,
  getSessionModel,
  setSessionModel,
  clearSessionModel,
  recordSessionProviderFailure,
  isSessionProviderPenalized,
  getSessionPenalizedProviders,
  clearSessionProviderFailure,
  clearAllSessionFailures,
} from "@/lib/jev/sessionModels.js";
import {
  getCachedJevDecision,
  setCachedJevDecision,
  clearCachedJevDecisionBySession,
  clearJevDecisionCache,
} from "@/lib/jev/decisionCache.js";
import { selectJevModel, extractSessionContext } from "@/sse/services/jevRouter.js";

describe("Session Provider Failover & Caching Circuit Breaker", () => {
  beforeEach(() => {
    clearAllSessionFailures();
    clearJevDecisionCache();
  });

  const dummyBody = {
    messages: [
      { role: "system", content: "You are a coding assistant" },
      { role: "user", content: "Implement quota failover circuit breaker" },
    ],
  };

  it("increments failure count and triggers penalty after threshold reached", () => {
    const sessKey = sessionKey(dummyBody);
    expect(sessKey).toBeTruthy();

    // 1st failure: below threshold (threshold = 2)
    const res1 = recordSessionProviderFailure(sessKey, "codex", 2);
    expect(res1.triggered).toBe(false);
    expect(res1.count).toBe(1);
    expect(isSessionProviderPenalized(sessKey, "codex")).toBe(false);

    // 2nd failure: reaches threshold
    const res2 = recordSessionProviderFailure(sessKey, "codex", 2);
    expect(res2.triggered).toBe(true);
    expect(res2.count).toBe(2);
    expect(res2.penalizedUntil).toBeGreaterThan(Date.now());
    expect(isSessionProviderPenalized(sessKey, "codex")).toBe(true);

    const penalizedSet = getSessionPenalizedProviders(sessKey);
    expect(penalizedSet.has("codex")).toBe(true);
  });

  it("penalizes a quota-exhausted provider on the first failure", () => {
    const sessKey = sessionKey(dummyBody);

    const result = recordSessionProviderFailure(sessKey, "gemini", 1);

    expect(result.triggered).toBe(true);
    expect(isSessionProviderPenalized(sessKey, "gemini")).toBe(true);
  });

  it("resets failure counter on request success", () => {
    const sessKey = sessionKey(dummyBody);
    recordSessionProviderFailure(sessKey, "codex", 2);
    clearSessionProviderFailure(sessKey, "codex");

    // Next failure starts at 1 again, not 2
    const res = recordSessionProviderFailure(sessKey, "codex", 2);
    expect(res.triggered).toBe(false);
    expect(res.count).toBe(1);
    expect(isSessionProviderPenalized(sessKey, "codex")).toBe(false);
  });

  it("clears cached decisions for a specific session", () => {
    const sessKey = sessionKey(dummyBody);
    setCachedJevDecision(sessKey, 1000, "codex/gpt-5-codex", "high");
    setCachedJevDecision("other_session", 1000, "glm/glm-4-plus", "low");

    expect(getCachedJevDecision(sessKey, 1000)).not.toBeNull();
    expect(getCachedJevDecision("other_session", 1000)).not.toBeNull();

    clearCachedJevDecisionBySession(sessKey);

    expect(getCachedJevDecision(sessKey, 1000)).toBeNull();
    expect(getCachedJevDecision("other_session", 1000)).not.toBeNull();
  });

  it("extractSessionContext strips previousModel if its provider is penalized", () => {
    const sessKey = sessionKey(dummyBody);
    setSessionModel(sessKey, "codex/gpt-5-codex");

    // Before penalty
    const ctxBefore = extractSessionContext(dummyBody, {
      providerFromModelId: (m) => m.split("/")[0],
    });
    expect(ctxBefore.previousModel).toBe("codex/gpt-5-codex");

    // Trigger penalty for codex
    recordSessionProviderFailure(sessKey, "codex", 1);
    expect(isSessionProviderPenalized(sessKey, "codex")).toBe(true);

    // After penalty: previousModel should be null (so not sticky)
    const ctxAfter = extractSessionContext(dummyBody, {
      providerFromModelId: (m) => m.split("/")[0],
    });
    expect(ctxAfter.previousModel).toBeNull();
  });

  it("selectJevModel bypasses cached decision if provider is penalized and pins new model", async () => {
    const sessKey = sessionKey(dummyBody);
    setSessionModel(sessKey, "codex/gpt-5-codex");
    setCachedJevDecision(sessKey, 0, "codex/gpt-5-codex", "high");

    // Mark codex penalized
    recordSessionProviderFailure(sessKey, "codex", 1);

    const availableModels = ["codex/gpt-5-codex", "glm/glm-4-plus"];

    // Mock fetch for Jev API to select GLM
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: {
          target_model: "glm/glm-4-plus",
        },
      }),
      text: async () => JSON.stringify({
        results: {
          target_model: "glm/glm-4-plus",
        },
      }),
    });

    const chosen = await selectJevModel(dummyBody, availableModels, {
      apiKey: "test-jev-key",
      fetch: mockFetch,
      providerFromModelId: (m) => m.split("/")[0],
    });

    expect(chosen).toBe("glm/glm-4-plus");
    // Verify new model is pinned sticky in sessionModels
    expect(getSessionModel(sessKey)).toBe("glm/glm-4-plus");

    // And subsequent call hits cache for GLM
    const nextCached = getCachedJevDecision(sessKey, 0);
    expect(nextCached?.model).toBe("glm/glm-4-plus");
  });
});
