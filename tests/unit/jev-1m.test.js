import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  JEV_MODEL_ALIASES,
  JEV1M_MODEL_ALIASES,
  selectJevModel,
} from "../../src/sse/services/jevRouter.js";

describe("jev-1m alias registry", () => {
  it("exports the jev-1m aliases, disjoint from jev aliases", () => {
    expect([...JEV1M_MODEL_ALIASES].sort()).toEqual([
      "jev-1m",
      "nineRouter/jev-1m",
    ]);
    for (const alias of JEV1M_MODEL_ALIASES) {
      expect(JEV_MODEL_ALIASES.has(alias)).toBe(false);
    }
  });

  it("selectJevModel never routes to a jev-1m alias", async () => {
    // No API key -> fail() falls back to the first NON-jev candidate.
    const result = await selectJevModel(
      { model: "jev-1m", messages: [] },
      ["jev-1m", "nineRouter/jev-1m", "cx/gpt-5.5"],
      {},
    );
    expect(result).toBe("cx/gpt-5.5");
  });

  it("v1/models advertises jev-1m statically like jev", () => {
    const src = readFileSync("src/app/api/v1/models/route.js", "utf8");
    expect(src.includes('["jev-1m", 1000000]')).toBe(true);
    expect(src.includes('["nineRouter/jev-1m", 1000000]')).toBe(true);
  });

  it("does not hide virtual Jev aliases when an upstream provider is health-disabled", () => {
    const src = readFileSync("src/app/api/v1/models/route.js", "utf8");
    expect(src).toContain('model.owned_by !== "9router" && permanentlyBlocked.has(model.id)');
  });

  it("chat.js narrows the pool for jev-1m (big-context filter)", () => {
    const src = readFileSync("src/sse/handlers/chat.js", "utf8");
    expect(src.includes("JEV1M_MODEL_ALIASES.has(modelStr)")).toBe(true);
    expect(src.includes("bigContext: isJev1m")).toBe(true);
    expect(src.includes("fitsJevContext(caps, estimatedTokens, body)")).toBe(true);
  });
});
