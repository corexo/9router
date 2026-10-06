import { describe, it, expect } from "vitest";
import { getProviderForModel, applyProviderBalancer } from "../../open-sse/services/combo.js";

describe("applyProviderBalancer", () => {
  it("maps model prefixes to canonical provider IDs correctly", () => {
    expect(getProviderForModel("cx/gpt-5.6-terra")).toBe("codex");
    expect(getProviderForModel("cc/claude-sonnet-5")).toBe("claude");
    expect(getProviderForModel("glm/glm-5.3-flash")).toBe("glm");
    expect(getProviderForModel("gemini/gemini-2.5-flash")).toBe("gemini");
    expect(getProviderForModel("nvidia/z-ai/glm-5.2")).toBe("nvidia");
    expect(getProviderForModel("gh/claude-haiku-4.5")).toBe("github");
    expect(getProviderForModel("ollama/qwen3.5")).toBe("ollama");
    expect(getProviderForModel("cf/@cf/meta/llama-3.1")).toBe("cloudflare-ai");
  });

  it("returns models untouched when balancer is disabled or missing", () => {
    const models = ["cx/gpt-5.6-terra", "cc/claude-sonnet-5", "glm/glm-5.3-flash"];
    expect(applyProviderBalancer(models, null)).toEqual(models);
    expect(applyProviderBalancer(models, { enabled: false })).toEqual(models);
  });

  it("returns models untouched when fewer than 2 eligible providers are configured", () => {
    const models = ["cx/gpt-5.6-terra", "cx/gpt-6-astra"];
    const balancer = {
      enabled: true,
      providers: {
        codex: { enabled: true, weight: 80 },
        claude: { enabled: true, weight: 20 },
      },
    };
    expect(applyProviderBalancer(models, balancer)).toEqual(models);
  });

  it("prioritizes the winning provider models to the front based on weight", () => {
    const models = ["cx/gpt-5.6-terra", "cc/claude-sonnet-5", "glm/glm-5.3-flash"];
    
    // Test 100% claude weight
    const claudeWins = {
      enabled: true,
      providers: {
        codex: { enabled: true, weight: 0 },
        claude: { enabled: true, weight: 100 },
        glm: { enabled: false, weight: 0 },
      },
    };
    const result1 = applyProviderBalancer(models, claudeWins);
    expect(result1[0]).toBe("cc/claude-sonnet-5");
    expect(result1).toContain("cx/gpt-5.6-terra");
    expect(result1).toContain("glm/glm-5.3-flash");

    // Test 100% codex weight
    const codexWins = {
      enabled: true,
      providers: {
        codex: { enabled: true, weight: 100 },
        claude: { enabled: true, weight: 0 },
      },
    };
    const result2 = applyProviderBalancer(models, codexWins);
    expect(result2[0]).toBe("cx/gpt-5.6-terra");

    // Test 100% glm weight
    const glmWins = {
      enabled: true,
      providers: {
        codex: { enabled: true, weight: 0 },
        claude: { enabled: true, weight: 0 },
        glm: { enabled: true, weight: 100 },
      },
    };
    const result3 = applyProviderBalancer(models, glmWins);
    expect(result3[0]).toBe("glm/glm-5.3-flash");
  });

  it("statistically distributes traffic across providers in a ratio close to their weights", () => {
    const models = ["cx/gpt-5.6-terra", "cc/claude-sonnet-5"];
    const balancer = {
      enabled: true,
      providers: {
        codex: { enabled: true, weight: 70 },
        claude: { enabled: true, weight: 30 },
      },
    };

    let codexFirst = 0;
    let claudeFirst = 0;
    const trials = 1000;

    for (let i = 0; i < trials; i++) {
      const res = applyProviderBalancer(models, balancer);
      if (res[0].startsWith("cx/")) codexFirst++;
      else if (res[0].startsWith("cc/")) claudeFirst++;
    }

    // Expect ~70% codex, ~30% claude (within binomial confidence interval 60%-80%)
    expect(codexFirst).toBeGreaterThan(600);
    expect(codexFirst).toBeLessThan(800);
    expect(claudeFirst).toBeGreaterThan(200);
    expect(claudeFirst).toBeLessThan(400);
  });
});
