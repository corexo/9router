import { describe, expect, it, vi } from "vitest";
import { adjudicateProviderError } from "../../src/sse/services/providerErrorAdjudication.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";

const quota = JSON.stringify({ error: {
  code: 429, status: "RESOURCE_EXHAUSTED",
  message: "Quota exceeded: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count per-model-per-minute FreeTier",
  details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "10s" }],
} });

describe("bounded provider-error adjudication", () => {
  it("extracts Gemini retry delay and bypasses Jev for obvious quota exhaustion", async () => {
    const parsed = await parseUpstreamError(new Response(quota, { status: 429 }), new GeminiCLIExecutor());
    expect(parsed.statusCode).toBe(429);
    expect(parsed.resetsAtMs - Date.now()).toBeGreaterThan(9000);
    expect(parsed.resetsAtMs - Date.now()).toBeLessThanOrEqual(10000);
    const fetchImpl = vi.fn();
    expect(await adjudicateProviderError({ provider: "gemini-cli", model: "gemini-2", status: 429, error: parsed.message, apiKey: "test", fetchImpl })).toMatchObject({ action: "next_account" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends only compact metadata and accepts a bounded account action", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ answers: { action: { choice: "next_account" } } }) }));
    const result = await adjudicateProviderError({ provider: "other", model: "m", status: 403, error: "unknown", apiKey: "test", fetchImpl });
    expect(result.action).toBe("next_account");
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(JSON.parse(sent.state)).toEqual({ provider: "other", model: "m", status: 403, retryAfterMs: null, error: "unknown", eligibleModels: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invented models and unsafe retry decisions", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ answers: { action: { choice: "next_model", model: "invented" } } }) }));
    const params = { provider: "other", model: "current", status: 503, error: "unknown", apiKey: "test", eligibleModels: ["configured"], fetchImpl };
    expect(await adjudicateProviderError(params)).toBeNull();
    fetchImpl.mockImplementation(async () => ({ ok: true, json: async () => ({ answers: { action: "retry_after" } }) }));
    expect(await adjudicateProviderError(params)).toBeNull();
    fetchImpl.mockImplementation(async () => ({ ok: true, json: async () => ({ answers: { action: { choice: "next_model", model: "configured" } } }) }));
    expect(await adjudicateProviderError(params)).toMatchObject({ action: "next_model", model: "configured" });
  });

  it("falls back when Jev fails or times out", async () => {
    const params = { provider: "other", model: "m", status: 403, error: "unknown", apiKey: "test" };
    expect(await adjudicateProviderError({ ...params, fetchImpl: async () => { throw new Error("offline"); } })).toBeNull();
    const fetchImpl = (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("timeout"))));
    expect(await adjudicateProviderError({ ...params, timeoutMs: 5, fetchImpl })).toBeNull();
  });
});
