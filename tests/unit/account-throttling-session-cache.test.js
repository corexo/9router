import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearSessionCache,
  getSessionConnection,
  setSessionConnection,
  clearSessionConnection,
  touchSessionCache,
  getSessionCacheSnapshot,
} from "../../src/lib/jev/sessionCache.js";

describe("Account Throttling & Session-Sticky Cache Registry", () => {
  beforeEach(() => {
    clearSessionCache();
  });

  it("stores and retrieves pinned connectionId for session stickiness", () => {
    const sessionKey = "test-session-key-123";
    expect(getSessionConnection(sessionKey)).toBeNull();

    setSessionConnection(sessionKey, "conn-claude-acc-1");
    expect(getSessionConnection(sessionKey)).toBe("conn-claude-acc-1");

    // Updating touchSessionCache preserves and exposes connectionId
    touchSessionCache(sessionKey, {
      model: "claude-3-7-sonnet-20250219",
      provider: "claude",
      promptTokens: 1500,
    });

    const snapshot = getSessionCacheSnapshot();
    expect(snapshot.length).toBe(1);
    expect(snapshot[0].connectionId).toBe("conn-claude-acc-1");
  });

  it("clears pinned connectionId when account fails", () => {
    const sessionKey = "test-session-key-456";
    setSessionConnection(sessionKey, "conn-codex-acc-2");
    expect(getSessionConnection(sessionKey)).toBe("conn-codex-acc-2");

    clearSessionConnection(sessionKey);
    expect(getSessionConnection(sessionKey)).toBeNull();
  });

  it("supports touchSessionCache with explicit connectionId", () => {
    const sessionKey = "test-session-key-789";
    touchSessionCache(sessionKey, {
      model: "glm-4-plus",
      provider: "glm",
      connectionId: "conn-glm-acc-3",
      promptTokens: 2000,
    });

    expect(getSessionConnection(sessionKey)).toBe("conn-glm-acc-3");
    const snapshot = getSessionCacheSnapshot();
    expect(snapshot[0].connectionId).toBe("conn-glm-acc-3");
  });

  it("simulates weighted throttling distribution for new sessions", () => {
    // Account 1: 80% throttled (weight = 20)
    // Account 2: 0% throttled (weight = 100)
    const accounts = [
      { id: "acc-1", name: "Acc 1", throttlePercent: 80 },
      { id: "acc-2", name: "Acc 2", throttlePercent: 0 },
    ];

    const pickAccount = (rnd) => {
      const candidates = accounts.filter(c => (c.throttlePercent || 0) < 100);
      const totalWeight = candidates.reduce((sum, c) => sum + Math.max(1, 100 - (c.throttlePercent || 0)), 0);
      let r = rnd * totalWeight;
      for (const cand of candidates) {
        const w = Math.max(1, 100 - (cand.throttlePercent || 0));
        r -= w;
        if (r <= 0) return cand;
      }
      return candidates[0];
    };

    // Total weight = 20 + 100 = 120
    // rnd <= 20/120 (0.166) -> Acc 1
    // rnd > 20/120 -> Acc 2
    expect(pickAccount(0.1).id).toBe("acc-1");
    expect(pickAccount(0.2).id).toBe("acc-2");
    expect(pickAccount(0.9).id).toBe("acc-2");
  });

  it("treats 100% throttled account as emergency standby only", () => {
    const accounts = [
      { id: "acc-standby", name: "Standby Acc", throttlePercent: 100 },
      { id: "acc-active", name: "Active Acc", throttlePercent: 0 },
    ];

    const pickAccount = (available) => {
      const nonStandby = available.filter(c => (c.throttlePercent || 0) < 100);
      const candidates = nonStandby.length > 0 ? nonStandby : available;
      return candidates[0];
    };

    // Both active: standby is filtered out
    expect(pickAccount(accounts).id).toBe("acc-active");

    // Active is excluded/down: standby is used as fallback
    expect(pickAccount([accounts[0]]).id).toBe("acc-standby");
  });

  it("filters and distributes only among accounts with dynamicBalanceEnabled = true", () => {
    // 3 accounts: Acc 1 and Acc 2 in balancer with 30/70 split. Acc 3 is NOT in balancer.
    const allAccounts = [
      { id: "acc-1", name: "Acc 1", dynamicBalanceEnabled: true, weight: 30 },
      { id: "acc-2", name: "Acc 2", dynamicBalanceEnabled: true, weight: 70 },
      { id: "acc-3", name: "Acc 3", dynamicBalanceEnabled: false, weight: 100 },
    ];

    const pickAccount = (available, rnd) => {
      const balancerAccounts = available.filter((c) => c.dynamicBalanceEnabled === true);
      const candidates = balancerAccounts.length > 0 ? balancerAccounts : available;
      const totalWeight = candidates.reduce((sum, c) => sum + Math.max(1, Number(c.weight || 0)), 0);
      let r = rnd * totalWeight;
      for (const cand of candidates) {
        r -= Math.max(1, Number(cand.weight || 0));
        if (r <= 0) return cand;
      }
      return candidates[0];
    };

    // When balancer is active, Acc 3 is NEVER picked!
    expect(pickAccount(allAccounts, 0.1).id).toBe("acc-1");
    expect(pickAccount(allAccounts, 0.25).id).toBe("acc-1");
    expect(pickAccount(allAccounts, 0.35).id).toBe("acc-2");
    expect(pickAccount(allAccounts, 0.9).id).toBe("acc-2");

    // If both balanced accounts are down, fallback to Acc 3
    expect(pickAccount([allAccounts[2]], 0.5).id).toBe("acc-3");
  });
});
