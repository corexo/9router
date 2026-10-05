import { describe, expect, it } from "vitest";

import { classifyModelFailure } from "../../src/lib/modelHealth.js";
import { readFileSync } from "node:fs";

describe("classifyModelFailure", () => {
  it("marks model_not_supported as permanent", () => {
    const result = classifyModelFailure(400, '{"error":{"code":"model_not_supported","message":"The requested model is not supported."}}');
    expect(result).toEqual({ type: "unsupported", scope: "permanent" });
  });

  it("marks deprecated provider models as permanent", () => {
    expect(classifyModelFailure(410, "Model has been deprecated: @cf/meta/llama-3.1-8b-instruct-awq")).toEqual({ type: "unsupported", scope: "permanent" });
  });

  it("does not disable a Codex model for every account when one ChatGPT account rejects it", () => {
    expect(classifyModelFailure(400, "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.")).toEqual({ type: "unsupported", scope: "request" });
  });

  it("blocks models with a hard upstream prompt cap (copilot 12288) from the pool", () => {
    const result = classifyModelFailure(400, '{"error":{"message":"prompt token count of 29633 exceeds the limit of 12288","code":"model_max_prompt_tokens_exceeded"}}');
    expect(result).toEqual({ type: "context_limit", scope: "capability" });
  });

  it("marks soft context overflow as request-scoped", () => {
    const result = classifyModelFailure(400, "Your input exceeds the context window of this model.");
    expect(result).toEqual({ type: "context_limit", scope: "request" });
  });

  it("marks cloudflare schema errors as capability incompatibility", () => {
    const result = classifyModelFailure(400, 'AiError: Bad input: Error: oneOf at \'/\' not met, Type mismatch of \'/messages/5/content\'');
    expect(result).toEqual({ type: "incompatible", scope: "capability" });
  });

  it("counts 5xx upstream errors toward daily model disable", () => {
    expect(classifyModelFailure(429, "rate limit")).toEqual({ type: "rate_limit", scope: "cooldown" });
    expect(classifyModelFailure(503, "upstream unavailable")).toEqual({ type: "temporary", scope: "counted" });
  });

  it("defaults to request-scoped for unknown errors", () => {
    expect(classifyModelFailure(402, "billing")).toEqual({ type: "unknown", scope: "request" });
  });
});

describe("daily model disable policy", () => {
  it("sets a threshold of three failures and 24-hour disable", () => {
    const source = readFileSync(new URL("../../src/lib/modelHealth.js", import.meta.url), "utf8");
    expect(source).toContain("const DAILY_FAILURE_THRESHOLD = 3;");
    expect(source).toContain("const DAILY_DISABLE_MS = 24 * 60 * 60 * 1000;");
  });
});

describe("classifyModelFailure context overflow", () => {
  it("classifies Cloudflare 413 code 5021 as request-scoped", () => {
    const result = classifyModelFailure(413, 'AiError: Ai: The estimated number of input and maximum output tokens (46185) exceeded this model context window limit (32768). code:5021');
    expect(result).toEqual({ type: "context_limit", scope: "request" });
  });

  it("recognizes GPT context overflow without cooling other sessions", () => {
    expect(classifyModelFailure(400, "Your input exceeds the context window of this model. Please adjust your input and try again.")).toEqual({ type: "context_limit", scope: "request" });
  });

  it("never cools a model down for a too-large request", () => {
    const result = classifyModelFailure(400, "This model maximum context length is 8192 tokens, however you requested 12000");
    expect(result.scope).toBe("request");
  });
});
