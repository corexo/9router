import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claims: null,
  getProviderConnectionById: vi.fn(),
  getProviderConnectionForUser: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async () => mocks.claims }));
vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  getProviderConnectionForUser: mocks.getProviderConnectionForUser,
  getProxyPoolById: mocks.getProxyPoolById,
  updateProviderConnection: mocks.updateProviderConnection,
  deleteProviderConnection: mocks.deleteProviderConnection,
}));

const { GET, PUT } = await import("../../src/app/api/providers/[id]/route.js");

const sharedConnection = {
  id: "oguz-conn",
  provider: "glm",
  ownerUsername: "Oguz",
  isShared: true,
  apiKey: "provider-secret",
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
  idToken: "id-secret",
  providerSpecificData: { proxyUrl: "http://secret-proxy" },
};

function params() { return { params: Promise.resolve({ id: "oguz-conn" }) }; }
function request(body = null) {
  return { json: async () => body || {}, headers: new Headers() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProxyPoolById.mockResolvedValue(null);
  mocks.updateProviderConnection.mockResolvedValue(sharedConnection);
});

describe("shared provider account access", () => {
  it("shows a shared account to a consumer without credentials/configuration", async () => {
    mocks.claims = { username: "Ugur" };
    mocks.getProviderConnectionForUser.mockResolvedValue(sharedConnection);
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(response.body.connection.id).toBe("oguz-conn");
    expect(response.body.connection.isShared).toBe(true);
    expect(response.body.connection.providerSpecificData).toBeUndefined();
    expect(response.body.connection.apiKey).toBeUndefined();
    expect(mocks.getProviderConnectionForUser).toHaveBeenCalledWith("oguz-conn", "Ugur");
  });

  it("rejects consumer mutation of a shared account", async () => {
    mocks.claims = { username: "Ugur" };
    mocks.getProviderConnectionById.mockResolvedValue(sharedConnection);
    const response = await PUT(request({ isShared: false }), params());
    expect(response.status).toBe(403);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("allows the owner to share or unshare the account", async () => {
    mocks.claims = { username: "Oguz" };
    mocks.getProviderConnectionById.mockResolvedValue(sharedConnection);
    const response = await PUT(request({ isShared: false }), params());
    expect(response.status).toBe(200);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("oguz-conn", expect.objectContaining({ isShared: false }));
  });
});
