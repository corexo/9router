import { describe, it, expect } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("getPricingForModel provider scoping", () => {
  it("returns null for ollama (cloud, flat-rate subscription) despite matching glm-4* pattern", () => {
    expect(getPricingForModel("ollama", "glm-4.7-flash")).toBeNull();
  });

  it("returns null for ollama (cloud) despite matching an exact MODEL_PRICING key (kimi-k2.5)", () => {
    expect(getPricingForModel("ollama", "kimi-k2.5")).toBeNull();
  });

  it("returns null for ollama-local (self-hosted) regardless of model name", () => {
    expect(getPricingForModel("ollama-local", "anything")).toBeNull();
    expect(getPricingForModel("ollama-local", "glm-4.7-flash")).toBeNull();
  });

  it("still returns correct pattern-matched pricing for the real GLM cloud provider (regression check)", () => {
    const pricing = getPricingForModel("glm", "glm-4.7-flash");
    expect(pricing).not.toBeNull();
    expect(pricing.input).toBeGreaterThan(0);
  });
});
