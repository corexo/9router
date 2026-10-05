import { describe, expect, it } from "vitest";
import { getSessionModel, sessionKey, setSessionModel } from "../../src/lib/jev/sessionModels.js";

describe("Jev session model stickiness", () => {
  it("keeps the same key as a conversation grows and remembers its model", () => {
    const firstTurn = { messages: [
      { role: "system", content: "You are a coding agent" },
      { role: "user", content: "Fix auth" },
    ] };
    const nextTurn = { messages: [
      ...firstTurn.messages,
      { role: "assistant", content: "Done" },
      { role: "user", content: "Also add tests" },
    ] };

    const key = sessionKey(firstTurn);
    expect(sessionKey(nextTurn)).toBe(key);
    setSessionModel(key, "cc/claude-sonnet-5");
    expect(getSessionModel(sessionKey(nextTurn))).toBe("cc/claude-sonnet-5");
  });
});

describe("sessionKey resilience across client restarts", () => {
  it("ignores a rewritten system prompt (Omni /restart scenario)", () => {
    const before = { messages: [
      { role: "system", content: "You are a coding agent. Today: 2026-10-02. Git: 86 dirty files." },
      { role: "user", content: "Fix auth" },
    ] };
    const afterRestart = { messages: [
      { role: "system", content: "You are a coding agent. Today: 2026-10-03. Git: clean." },
      { role: "user", content: "Fix auth" },
    ] };
    expect(sessionKey(afterRestart)).toBe(sessionKey(before));
  });

  it("prefers an explicit client session id over content hashing", () => {
    const a = { prompt_cache_key: "conv-42", messages: [
      { role: "system", content: "prompt A" },
      { role: "user", content: "hello" },
    ] };
    const b = { metadata: { session_id: "conv-42" }, messages: [
      { role: "system", content: "totally different" },
      { role: "user", content: "hello" },
    ] };
    expect(sessionKey(b)).toBe(sessionKey(a));
  });

  it("still distinguishes conversations with different first user turns", () => {
    const a = { messages: [
      { role: "system", content: "same system" },
      { role: "user", content: "Fix auth" },
    ] };
    const b = { messages: [
      { role: "system", content: "same system" },
      { role: "user", content: "Fix payments" },
    ] };
    expect(sessionKey(b)).not.toBe(sessionKey(a));
  });
});
