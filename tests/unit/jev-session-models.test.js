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
