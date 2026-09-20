import { describe, expect, it } from "vitest";

import { classifyModelFailure } from "../../src/lib/modelHealth.js";

describe("classifyModelFailure", () => {
  it("marks model_not_supported as permanent", () => {
    const result = classifyModelFailure(400, '{"error":{"code":"model_not_supported","message":"The requested model is not supported."}}');
    expect(result).toEqual({ type: "unsupported", scope: "permanent" });
  });

  it("marks token limit as request-scoped", () => {
    const result = classifyModelFailure(400, "prompt token count of 57265 exceeds the limit of 12288");
    expect(result).toEqual({ type: "context_limit", scope: "request" });
  });

  it("marks cloudflare schema errors as capability incompatibility", () => {
    const result = classifyModelFailure(400, 'AiError: Bad input: Error: oneOf at \'/\' not met, Type mismatch of \'/messages/5/content\'');
    expect(result).toEqual({ type: "incompatible", scope: "capability" });
  });

  it("marks 429 and 5xx as cooldown", () => {
    expect(classifyModelFailure(429, "rate limit")).toEqual({ type: "rate_limit", scope: "cooldown" });
    expect(classifyModelFailure(503, "upstream unavailable")).toEqual({ type: "temporary", scope: "cooldown" });
  });

  it("defaults to request-scoped for unknown errors", () => {
    expect(classifyModelFailure(402, "billing")).toEqual({ type: "unknown", scope: "request" });
  });
});

describe("classifyModelFailure context overflow", () => {
  it("classifies Cloudflare 413 code 5021 as request-scoped", () => {
    const result = classifyModelFailure(413, 'AiError: Ai: The estimated number of input and maximum output tokens (46185) exceeded this model context window limit (32768). code:5021');
    expect(result).toEqual({ type: "context_limit", scope: "request" });
  });

  it("never cools a model down for a too-large request", () => {
    const result = classifyModelFailure(400, "This model maximum context length is 8192 tokens, however you requested 12000");
    expect(result.scope).toBe("request");
  });
});
