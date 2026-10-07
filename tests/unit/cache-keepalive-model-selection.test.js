import { describe, expect, it } from "vitest";
import { CACHE_KEEPALIVE_MODEL_BLACKLIST, chooseSmallestContextModel, isCacheKeepAliveModelBlacklisted } from "../../src/sse/services/cacheKeepAliveModel.js";

describe("keep-alive probe model selection", () => {
  it("chooses the smallest same-provider model that fits prompt context plus safety margin", () => {
    const models = [
      { model: "small-30k", contextWindow: 30_000 },
      { model: "mid-60k", contextWindow: 60_000 },
      { model: "large-100k", contextWindow: 100_000 },
    ];
    expect(chooseSmallestContextModel(models, 50_000)?.model).toBe("mid-60k");
  });

  it("prefers standard over review variants when context sizes tie", () => {
    const models = [
      { model: "gpt-6-sol-review", contextWindow: 1_000_000 },
      { model: "gpt-6-sol", contextWindow: 1_000_000 },
    ];
    expect(chooseSmallestContextModel(models, 50_000)?.model).toBe("gpt-6-sol");
  });

  it("never selects or falls back to a blacklisted model", () => {
    expect(CACHE_KEEPALIVE_MODEL_BLACKLIST.has("gpt-5.4")).toBe(true);
    expect(isCacheKeepAliveModelBlacklisted("cx/gpt-5.4")).toBe(true);
    expect(chooseSmallestContextModel([
      { model: "cx/gpt-5.4", contextWindow: 128_000 },
      { model: "cx/gpt-6-sol", contextWindow: 1_000_000 },
    ], 50_000)?.model).toBe("cx/gpt-6-sol");
    expect(chooseSmallestContextModel([{ model: "cx/gpt-5.4", contextWindow: 128_000 }], 50_000)).toBeNull();
  });

  it("returns null when no candidate has enough context", () => {
    expect(chooseSmallestContextModel([{ model: "small", contextWindow: 30_000 }], 50_000)).toBeNull();
  });
});
