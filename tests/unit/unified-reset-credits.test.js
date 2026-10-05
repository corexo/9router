import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  getCodexRateLimitResetCredits: vi.fn(),
  consumeCodexRateLimitResetCredit: vi.fn(),
  getUsageForProvider: vi.fn(),
  clearClaudeUsageCache: vi.fn(),
  clearConnectionLocks: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getCodexRateLimitResetCredits: mocks.getCodexRateLimitResetCredits,
  consumeCodexRateLimitResetCredit: mocks.consumeCodexRateLimitResetCredit,
  getUsageForProvider: mocks.getUsageForProvider,
  clearClaudeUsageCache: mocks.clearClaudeUsageCache,
}));

vi.mock("@/sse/services/auth.js", () => ({
  clearConnectionLocks: mocks.clearConnectionLocks,
}));

describe("Unified reset credits API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it("handles Claude GET and POST correctly", async () => {
    const { GET, POST } = await import("../../src/app/api/usage/[connectionId]/reset-credits/route.js");
    const connection = {
      id: "claude-conn-1",
      provider: "claude",
      authType: "oauth",
      accessToken: "claude-token-abc",
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getUsageForProvider.mockResolvedValue({
      resetCredits: { availableCount: 2 },
      quotas: {},
    });

    // Test GET
    const getRes = await GET(new Request("http://localhost"), { params: Promise.resolve({ connectionId: "claude-conn-1" }) });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.provider).toBe("claude");
    expect(getData.availableCount).toBe(2);

    // Test POST
    const postRes = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ connectionId: "claude-conn-1" }) });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.reset).toBe(true);
    expect(postData.provider).toBe("claude");
    expect(mocks.clearClaudeUsageCache).toHaveBeenCalledWith("claude-token-abc");
    expect(mocks.clearConnectionLocks).toHaveBeenCalledWith("claude-conn-1");
  });

  it("handles GLM GET and POST correctly", async () => {
    const { GET, POST } = await import("../../src/app/api/usage/[connectionId]/reset-credits/route.js");
    const connection = {
      id: "glm-conn-1",
      provider: "glm",
      authType: "apikey",
      apiKey: "glm-api-key",
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getUsageForProvider.mockResolvedValue({
      resetCredits: { availableCount: 1 },
      quotas: {},
    });

    // Test GET
    const getRes = await GET(new Request("http://localhost"), { params: Promise.resolve({ connectionId: "glm-conn-1" }) });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.provider).toBe("glm");
    expect(getData.availableCount).toBe(1);

    // Test POST
    const postRes = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ connectionId: "glm-conn-1" }) });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.reset).toBe(true);
    expect(postData.provider).toBe("glm");
    expect(mocks.clearConnectionLocks).toHaveBeenCalledWith("glm-conn-1");
  });

  it("rejects unsupported providers with 400", async () => {
    const { GET, POST } = await import("../../src/app/api/usage/[connectionId]/reset-credits/route.js");
    const connection = {
      id: "other-conn-1",
      provider: "github",
      authType: "oauth",
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);

    const getRes = await GET(new Request("http://localhost"), { params: Promise.resolve({ connectionId: "other-conn-1" }) });
    expect(getRes.status).toBe(400);

    const postRes = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ connectionId: "other-conn-1" }) });
    expect(postRes.status).toBe(400);
  });
});
