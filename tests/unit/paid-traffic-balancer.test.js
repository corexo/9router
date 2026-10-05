import { describe, expect, it } from "vitest";
import { accountUsageFingerprint, isPaidModel, shouldRefreshPaidTraffic, validatePaidTrafficDistribution } from "../../src/lib/jev/paidTrafficBalancer.js";

describe("paid traffic balancer", () => {
  it("excludes free models and recognizes priced paid models", () => {
    const pricing = (_provider, model) => model.includes("free") ? null : { input: 1, output: 2 };
    expect(isPaidModel("zai/glm-4:free", () => "zai", pricing)).toBe(false);
    expect(isPaidModel("codex/gpt-5-codex", () => "codex", pricing)).toBe(true);
  });

  it("accepts only known account weights and normalizes them", () => {
    expect(validatePaidTrafficDistribution({ a: 20, b: 80 }, [{ id: "a" }, { id: "b" }])).toEqual({ a: 0.2, b: 0.8 });
    expect(validatePaidTrafficDistribution({ a: -3 }, [{ id: "a" }])).toBeNull();
    expect(validatePaidTrafficDistribution({ a: 0 }, [{ id: "a" }])).toBeNull();
  });

  it("refreshes only on changed usage after ten minutes", () => {
    const accounts = [{ id: "a", used: 10, limit: 100 }];
    const snapshot = { fingerprint: accountUsageFingerprint(accounts) };
    expect(shouldRefreshPaidTraffic({ fingerprint: snapshot.fingerprint, lastRequestedAt: 0 }, snapshot.fingerprint, 700_000)).toBe(false);
    expect(shouldRefreshPaidTraffic({ fingerprint: snapshot.fingerprint, lastRequestedAt: 0 }, "changed", 599_999)).toBe(false);
    expect(shouldRefreshPaidTraffic({ fingerprint: snapshot.fingerprint, lastRequestedAt: 0 }, "changed", 600_000)).toBe(true);
  });
});
