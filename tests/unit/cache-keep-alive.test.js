import { describe, it, expect, beforeEach } from "vitest";
import {
  touchSessionCache,
  clearSessionCache,
  setSessionKeepAlive,
  getKeepAliveCandidates,
  recordKeepAliveResult,
  getTopSessions,
} from "../../src/lib/jev/sessionCache.js";

const KEY_1 = "test-session-1";
const KEY_2 = "test-session-2";
const KEY_3 = "test-session-3";

describe("cache keep-alive and top sessions", () => {
  beforeEach(() => {
    clearSessionCache();
  });

  it("identifies top sessions ranked by request count and tokens", () => {
    touchSessionCache(KEY_1, { model: "claude-3-7-sonnet", provider: "anthropic", promptTokens: 5000 });
    touchSessionCache(KEY_1, { model: "claude-3-7-sonnet", provider: "anthropic", promptTokens: 2000 });

    touchSessionCache(KEY_2, { model: "gpt-4o", provider: "openai", promptTokens: 1000 });

    touchSessionCache(KEY_3, { model: "claude-3-5-sonnet", provider: "anthropic", promptTokens: 8000 });
    touchSessionCache(KEY_3, { model: "claude-3-5-sonnet", provider: "anthropic", promptTokens: 4000 });
    touchSessionCache(KEY_3, { model: "claude-3-5-sonnet", provider: "anthropic", promptTokens: 3000 });

    const top = getTopSessions(3, "activity");
    expect(top).toHaveLength(3);
    // KEY_3 has 3 requests, KEY_1 has 2, KEY_2 has 1
    expect(top[0].requests).toBe(3);
    expect(top[1].requests).toBe(2);
    expect(top[2].requests).toBe(1);
  });

  it("toggles keepAliveEnabled on a session", () => {
    const id = touchSessionCache(KEY_1, { model: "claude-3-7-sonnet", provider: "anthropic" });
    expect(setSessionKeepAlive(id, true)).toBe(true);

    const top = getTopSessions(1);
    expect(top[0].keepAliveEnabled).toBe(true);

    expect(setSessionKeepAlive(id, false)).toBe(true);
    const updated = getTopSessions(1);
    expect(updated[0].keepAliveEnabled).toBe(false);
  });

  it("selects candidates for keep-alive probing when idle in trigger window with probePrefix", () => {
    const probePrefix = {
      model: "anthropic/claude-3-7-sonnet",
      provider: "anthropic",
      messages: [{ role: "system", content: "You are an assistant" }],
    };

    touchSessionCache(KEY_1, {
      model: "anthropic/claude-3-7-sonnet",
      provider: "anthropic",
      probePrefix,
    });

    // Manually adjust lastActive to 4 minutes ago (240_000ms)
    const sessions = globalThis[Symbol.for("9router.sessionCache")];
    const entry = sessions.get(KEY_1);
    entry.lastActive = Date.now() - 240_000;

    const candidates = getKeepAliveCandidates({
      minIdleMs: 200_000,
      maxIdleMs: 280_000,
      topN: 3,
      globalEnabled: true,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].sessionKey).toBe(KEY_1);
    expect(candidates[0].probePrefix.model).toBe("anthropic/claude-3-7-sonnet");
  });

  it("stops probing after 45 minutes without real requests despite successful pings", () => {
    touchSessionCache(KEY_1, {
      model: "anthropic/claude-3-7-sonnet",
      provider: "anthropic",
      probePrefix: { model: "anthropic/claude-3-7-sonnet", messages: [{ role: "system", content: "test" }] },
    });
    const entry = globalThis[Symbol.for("9router.sessionCache")].get(KEY_1);
    entry.lastUserActive = Date.now() - 46 * 60_000;
    entry.lastActive = Date.now() - 240_000;
    setSessionKeepAlive(KEY_1, true);
    recordKeepAliveResult(KEY_1, { success: true });
    entry.lastActive = Date.now() - 240_000;

    expect(getKeepAliveCandidates({ minIdleMs: 200_000, maxIdleMs: 280_000, topN: 0 })).toHaveLength(0);
  });

  it("keeps top sessions for up to two hours after genuine traffic, not longer", () => {
    touchSessionCache(KEY_1, {
      model: "anthropic/claude-3-7-sonnet",
      provider: "anthropic",
      probePrefix: { model: "anthropic/claude-3-7-sonnet", messages: [{ role: "system", content: "test" }] },
    });
    const entry = globalThis[Symbol.for("9router.sessionCache")].get(KEY_1);
    entry.lastActive = Date.now() - 240_000;
    entry.lastUserActive = Date.now() - 90 * 60_000;
    expect(getKeepAliveCandidates({ minIdleMs: 200_000, maxIdleMs: 280_000 })).toHaveLength(1);
    recordKeepAliveResult(KEY_1, { success: true });
    entry.lastActive = Date.now() - 240_000;
    entry.lastUserActive = Date.now() - 121 * 60_000;
    expect(getKeepAliveCandidates({ minIdleMs: 200_000, maxIdleMs: 280_000 })).toHaveLength(0);
  });

  it("records probe results and updates keepAlive counters", () => {
    touchSessionCache(KEY_1, { model: "claude-3-7-sonnet", provider: "anthropic" });

    recordKeepAliveResult(KEY_1, {
      success: true,
      cachedTokens: 4500,
      latencyMs: 120,
    });

    const [session] = getTopSessions(1);
    expect(session.keepAlivePingCount).toBe(1);
    expect(session.lastKeepAliveStatus).toBe("ok");
    expect(session.cachedTokens).toBe(4500);
    expect(session.lastKeepAliveAt).not.toBeNull();
  });
});
