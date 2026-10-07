import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  hasUsers: vi.fn(),
  username: "Ugur",
}));

vi.mock("@/models", () => ({ createProviderConnection: mocks.createProviderConnection }));
vi.mock("@/lib/localDb", () => ({ hasUsers: mocks.hasUsers }));
vi.mock("@/lib/auth/requestUser", () => ({ getRequestUsername: async () => mocks.username }));

const { createOwnedProviderConnection } = await import("../../src/lib/tenant/providerOwnership.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasUsers.mockResolvedValue(true);
  mocks.createProviderConnection.mockImplementation(async (data) => data);
});

describe("owned provider creation", () => {
  it("tags new OAuth/API-key connections private to the dashboard user", async () => {
    const connection = await createOwnedProviderConnection({ provider: "glm", authType: "apikey", apiKey: "secret" });
    expect(connection).toMatchObject({ provider: "glm", ownerUsername: "Ugur", isShared: false });
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({ ownerUsername: "Ugur", isShared: false }));
  });

  it("refuses connection creation in multi-user mode without a caller", async () => {
    mocks.username = null;
    await expect(createOwnedProviderConnection({ provider: "glm", authType: "apikey" })).rejects.toThrow(/Authenticated user required/);
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });
});
