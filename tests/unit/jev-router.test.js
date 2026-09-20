import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJevPrompt, selectJevModel } from "../../src/sse/services/jevRouter.js";

describe("Jev router", () => {
  afterEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_ROUTER_DEFAULT_MODEL;
  });

  it("extracts latest user text parts and truncates them", () => {
    const prompt = extractJevPrompt({ messages: [
      { role: "user", content: "old" },
      { role: "assistant", content: "reply" },
      { role: "user", content: [{ type: "text", text: "a".repeat(2999) }, { type: "image" }, { type: "text", text: "tail" }] },
    ] });
    expect(prompt).toHaveLength(3000);
  });

  it("sends active models and accepts valid selection", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ results: { target_model: { selected: "openai/gpt-4o" } } }) }));
    expect(await selectJevModel({ input: "code" }, ["openai/gpt-4o", "jev"], { fetch: fetchMock })).toBe("openai/gpt-4o");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("jev-1.13.0");
    expect(body.questions.target_model.options).toBeUndefined();
    expect(Object.keys(body.questions.target_model.criteria)).toEqual(["openai/gpt-4o"]);
  });

  it("falls back without API call when key is missing", async () => {
    process.env.JEV_ROUTER_DEFAULT_MODEL = "anthropic/claude";
    const fetchMock = vi.fn();
    expect(await selectJevModel({}, ["openai/gpt-4o"], { fetch: fetchMock, warn: vi.fn() })).toBe("anthropic/claude");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses answers.<id>.choice like the live API", async () => {
    const fetchMock = async () => ({ ok: true, json: async () => ({ answers: { target_model: { choice: "openai/gpt-4o", confidence: 0.9 } } }) });
    expect(await selectJevModel({}, ["openai/gpt-4o"], { apiKey: "k", fetch: fetchMock })).toBe("openai/gpt-4o");
  });

  it("accepts alternative response nestings", async () => {
    const fetchMock = async () => ({ ok: true, json: async () => ({ answers: { target_model: "openai/gpt-4o" } }) });
    expect(await selectJevModel({}, ["openai/gpt-4o"], { apiKey: "k", fetch: fetchMock })).toBe("openai/gpt-4o");
  });

  it("sends systemone-style body", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ results: { target_model: { selected: "openai/gpt-4o" } } }) }));
    await selectJevModel({ input: "hi" }, ["openai/gpt-4o"], { apiKey: "k", fetch: fetchMock });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.state).toBe("hi");
    expect(Object.keys(sent.questions.target_model.criteria)).toEqual(["openai/gpt-4o"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://jev-ai.pro/api/v1/systemone");
  });

  it("prefers UI settings over env", async () => {
    process.env.TYPESAFE_API_KEY = "env-key";
    process.env.JEV_ROUTER_DEFAULT_MODEL = "env/model";
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    const selected = await selectJevModel({}, ["openai/gpt-4o"], {
      apiKey: "ui-key", defaultModel: "ui/model", timeoutMs: 50, fetch: fetchMock, warn: vi.fn(),
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer ui-key");
    expect(selected).toBe("ui/model");
  });

  it("rejects unavailable selections", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    process.env.JEV_ROUTER_DEFAULT_MODEL = "openai/gpt-4o";
    const fetch = async () => ({ ok: true, json: async () => ({ results: { target_model: { selected: "unknown" } } }) });
    expect(await selectJevModel({}, ["openai/gpt-4o"], { fetch, warn: vi.fn() })).toBe("openai/gpt-4o");
  });
});
