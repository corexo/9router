import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  touchSessionCache,
  getSessionCacheSnapshot,
  getSessionCacheById,
  getSessionCacheMeta,
  clearSessionCacheByModel,
  clearSessionCache,
  supportsPromptCache,
} from "../../src/lib/jev/sessionCache.js";

const KEY_A = "session-key-a";
const KEY_B = "session-key-b";

describe("session cache registry", () => {
  beforeEach(() => {
    clearSessionCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a stable, opaque random id that differs from the session key hash", () => {
    const id = touchSessionCache(KEY_A, { model: "cc/claude-sonnet-5" });
    expect(id).toBeTruthy();
    expect(id).not.toBe(KEY_A);
    // Not derived from the key: a second session must get a different id.
    const other = touchSessionCache(KEY_B, { model: "glm/glm-4.6" });
    expect(other).not.toBe(id);
    // Repeated touches return the same id.
    expect(touchSessionCache(KEY_A, { model: "cc/claude-sonnet-5" })).toBe(id);
  });

  it("counts requests and updates lastActive on every touch", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6" });
    vi.advanceTimersByTime(10_000);
    touchSessionCache(KEY_A, { model: "glm/glm-4.6" });

    const [entry] = getSessionCacheSnapshot();
    expect(entry.requests).toBe(2);
    expect(new Date(entry.lastActive).getTime()).toBe(Date.now());
  });

  it("accumulates cached and prompt tokens and derives cacheActive", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6", provider: "glm", promptTokens: 1000 });
    touchSessionCache(KEY_A, { model: "glm/glm-4.6", provider: "glm", promptTokens: 500, cachedTokens: 800 });

    const [entry] = getSessionCacheSnapshot();
    expect(entry.promptTokens).toBe(1500);
    expect(entry.cachedTokens).toBe(800);
    expect(entry.cacheActive).toBe(true); // cached tokens + cache-capable provider seen
  });

  it("keeps cacheActive false without cached tokens or capable provider", () => {
    touchSessionCache(KEY_A, { model: "x/some-model", provider: "other", promptTokens: 100 });
    const [entry] = getSessionCacheSnapshot();
    expect(entry.cacheActive).toBe(false);

    // Capable provider but no cached tokens yet
    clearSessionCache();
    touchSessionCache(KEY_A, { model: "glm/glm-4.6", provider: "glm", promptTokens: 100 });
    const [second] = getSessionCacheSnapshot();
    expect(second.cacheActive).toBe(false);
  });

  it("marks cacheActive when the decision-cache hit flag is passed", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6", provider: "glm", cacheActive: true });
    const [entry] = getSessionCacheSnapshot();
    expect(entry.cacheActive).toBe(true);
  });

  it("collects models as a set across model switches", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6" });
    touchSessionCache(KEY_A, { model: "cc/claude-sonnet-5" });
    touchSessionCache(KEY_A, { model: "glm/glm-4.6" }); // duplicate

    const [entry] = getSessionCacheSnapshot();
    expect(entry.models).toEqual(["glm/glm-4.6", "cc/claude-sonnet-5"]);
  });

  it("reports active within 5 minutes of lastActive, idle afterwards", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6" });
    expect(getSessionCacheSnapshot()[0].state).toBe("active");

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getSessionCacheSnapshot()[0].state).toBe("idle");
  });

  it("evicts entries after the 2h TTL and caps the store at 200 sessions", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6" });
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
    touchSessionCache(KEY_B, { model: "glm/glm-4.6" }); // triggers pruning on access

    expect(getSessionCacheSnapshot().map((e) => e.cacheId)).toHaveLength(1);

    for (let i = 0; i < 210; i++) touchSessionCache(`bulk-${i}`, { model: "glm/glm-4.6" });
    expect(getSessionCacheSnapshot()).toHaveLength(200); // MAX_SESSIONS cap
  });

  it("stores no prompt text or credentials (field whitelist)", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6", provider: "glm", promptTokens: 10 });
    const [entry] = getSessionCacheSnapshot();
    expect(Object.keys(entry).sort()).toEqual([
      "cacheActive", "cacheId", "cachedTokens", "connectionId", "createdAt",
      "hasProbePrefix", "keepAliveEnabled", "keepAlivePingCount", "lastActive",
      "lastKeepAliveAt", "lastKeepAliveStatus", "models", "promptTokens",
      "providers", "requests", "state", "ttlRemainingSecs"
    ].sort());
    const raw = JSON.stringify(entry);
    expect(raw).not.toContain("messages");
    expect(raw).not.toContain("api");
    expect(raw).not.toContain("token-"); // no bearer/API key material
  });

  it("looks up a session by opaque id and returns meta for the response injection", () => {
    const id = touchSessionCache(KEY_A, { model: "glm/glm-4.6", provider: "glm" });

    expect(getSessionCacheById(id)?.cacheId).toBe(id);
    expect(getSessionCacheById("does-not-exist")).toBeNull();

    const meta = getSessionCacheMeta(KEY_A);
    expect(meta).toEqual({ cacheId: id, cacheActive: false, model: "glm/glm-4.6" });
    expect(getSessionCacheMeta("nope")).toBeNull();
  });

  it("clears sessions by model", () => {
    touchSessionCache(KEY_A, { model: "glm/glm-4.6" });
    touchSessionCache(KEY_B, { model: "cc/claude-sonnet-5" });
    clearSessionCacheByModel("glm/glm-4.6");
    expect(getSessionCacheSnapshot()).toHaveLength(1);
    expect(getSessionCacheSnapshot()[0].models).toEqual(["cc/claude-sonnet-5"]);
  });

  it("classifies prompt-cache capable provider families", () => {
    for (const provider of ["codex", "chatgpt", "glm", "glm-cn", "zai", "anthropic", "claude"]) {
      expect(supportsPromptCache(provider)).toBe(true);
    }
    for (const provider of ["antigravity", "gemini-cli", "unknown", "", null, undefined]) {
      expect(supportsPromptCache(provider)).toBe(false);
    }
  });
});
