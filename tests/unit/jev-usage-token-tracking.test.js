import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const mocks = vi.hoisted(() => ({ saveRequestUsage: vi.fn() }));
vi.mock("../../src/lib/db/repos/settingsRepo.js", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("../../src/lib/db/repos/usageRepo.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));

const { recordJevUsage, extractTokenUsage } = await import("../../src/lib/jev/client.js");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Jev token usage tracking", () => {
  it("uses separate provider-reported input and output counts when available", () => {
    expect(extractTokenUsage({ usage: { prompt_tokens: 11, completion_tokens: 7 } }, "request", "response"))
      .toEqual({ promptTokens: 11, completionTokens: 7 });
  });

  it("estimates input and output separately when Jev omits usage", () => {
    expect(extractTokenUsage({}, "12345678", "1234"))
      .toEqual({ promptTokens: 2, completionTokens: 1 });
  });

  it("persists input/output tokens and the caller API key for per-user aggregation", async () => {
    recordJevUsage({ endpoint: "model-router", apiKey: "opaque-test-key", promptTokens: 123, completionTokens: 45, status: "success" });
    await new Promise((resolveNext) => setImmediate(resolveNext));
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "opaque-test-key",
      tokens: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
      meta: expect.objectContaining({ promptTokens: 123, completionTokens: 45, tokens: 168 }),
    }));
  });

  it("aggregates input/output totals and daily series, scoped by API-key owner", () => {
    const repo = readFileSync(resolve(root, "src/lib/db/repos/usageRepo.js"), "utf8");
    const route = readFileSync(resolve(root, "src/app/api/usage/jev/route.js"), "utf8");
    expect(repo).toContain("stats.promptTokens += Number(meta.promptTokens ?? 0)");
    expect(repo).toContain("stats.completionTokens += Number(meta.completionTokens ?? 0)");
    expect(repo).toContain("bucket.promptTokens += Number(meta.promptTokens ?? 0)");
    expect(repo).toContain("bucket.completionTokens += Number(meta.completionTokens ?? 0)");
    expect(route).toContain("getJevStats(period, ownerUsername)");
  });

  it("renders input and output token totals and trends", () => {
    const chart = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/usage/components/JevChart.js"), "utf8");
    expect(chart).toContain('label: "Tokens in/out"');
    expect(chart).toContain('dataKey="promptTokens" name="Input tokens"');
    expect(chart).toContain('dataKey="completionTokens" name="Output tokens"');
  });
});
