import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ all: vi.fn(), get: vi.fn() }));
vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => ({ all: mocks.all, get: mocks.get }) }));
vi.mock("../../src/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: async () => [{ id: "shared-glm", ownerUsername: "Oguz", isShared: true, name: "Shared GLM" }],
}));
vi.mock("../../src/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: async () => [{ key: "ugur-owned-key", ownerUsername: "Ugur", name: "Ugur Key" }],
}));
vi.mock("../../src/lib/db/repos/nodesRepo.js", () => ({ getProviderNodes: async () => [] }));

const { getUsageStats } = await import("../../src/lib/db/repos/usageRepo.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.all.mockImplementation((sql) => {
    if (sql.includes("FROM usageHistory") && sql.includes("apiKey IN")) {
      return [{
        timestamp: new Date().toISOString(), provider: "glm", model: "glm-5.3", connectionId: "shared-glm",
        apiKey: "ugur-owned-key", endpoint: "/v1/chat/completions", promptTokens: 120, completionTokens: 20,
        tokens: JSON.stringify({ prompt_tokens: 120, completion_tokens: 20 }), cost: 0.01, status: "ok",
      }];
    }
    return [];
  });
});

describe("account-sharing usage isolation", () => {
  it("uses caller-key history while allowing a visible shared account name", async () => {
    const stats = await getUsageStats("24h", "Ugur");
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalPromptTokens).toBe(120);
    expect(stats.totalCompletionTokens).toBe(20);
    expect(Object.values(stats.byAccount)[0]).toMatchObject({ accountName: "Shared GLM", connectionId: "shared-glm" });
    expect(mocks.all.mock.calls.some(([sql, params]) => sql.includes("apiKey IN") && params.includes("Ugur"))).toBe(true);
  });
});
