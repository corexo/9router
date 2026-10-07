import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), hasUsers: vi.fn(), verifyLogin: vi.fn(),
  getUserByUsername: vi.fn(), setDashboardAuthCookie: vi.fn(), verifyDashboardAuthToken: vi.fn(), isLocalRequest: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: {
  json: (body, init) => ({ status: init?.status || 200, body }),
  next: () => ({ status: 200 }),
  redirect: () => ({ status: 302 }),
} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings, hasUsers: mocks.hasUsers,
  verifyLogin: mocks.verifyLogin, getUserByUsername: mocks.getUserByUsername,
  validateApiKey: vi.fn(),
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  getDashboardAuthSession: vi.fn(),
}));
vi.mock("@/dashboardGuard", async (importOriginal) => ({ ...await importOriginal(), isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: () => false }));
vi.mock("@/lib/auth/saml", () => ({ isSamlConfigured: () => false }));
vi.mock("@/lib/db/repos/authAuditRepo.js", () => ({ recordLoginAttempt: vi.fn(), listLoginAudit: vi.fn() }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "cli" }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: () => false }));

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { GET } = await import("../../src/app/api/auth/status/route.js");
const { proxy } = await import("../../src/dashboardGuard.js");
const { recordSuccess } = await import("../../src/lib/auth/loginLimiter.js");

function request(path, method, body) {
  const url = `http://localhost:20128${path}`;
  return {
    ...new Request(url, { method, ...(body && { body: JSON.stringify(body) }) }),
    headers: new Headers({ host: "localhost:20128" }),
    url, method, nextUrl: new URL(url),
    cookies: { get: () => ({ value: "token" }) },
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recordSuccess("unknown");
  mocks.getSettings.mockResolvedValue({ password: "unused", requireLogin: true });
  mocks.hasUsers.mockResolvedValue(true);
  mocks.isLocalRequest.mockReturnValue(true);
  mocks.verifyLogin.mockResolvedValue({ id: "id-1", username: "Oguz", role: "moderator" });
  mocks.verifyDashboardAuthToken.mockResolvedValue({ sub: "id-1", username: "Oguz", role: "moderator" });
  mocks.getUserByUsername.mockResolvedValue({ id: "id-1", username: "Oguz", role: "moderator", isActive: 1 });
});

describe("multi-user login", () => {
  it("issues JWT claims for a valid user", async () => {
    const res = await POST(request("/api/auth/login", "POST", { username: "Oguz", password: "correct" }));
    expect(res.status).toBe(200);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      { sub: "id-1", username: "Oguz", role: "moderator" });
  });
  it("forces password rotation for seeded default-password users", async () => {
    mocks.verifyLogin.mockResolvedValue({ id: "id-1", username: "Oguz", role: "admin", mustChangePassword: 1 });
    const res = await POST(request("/api/auth/login", "POST", { username: "Oguz", password: "123456" }));
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalled();
  });
  it("gates forced-rotation users to password change until completed", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue({ sub: "id-1", username: "Oguz", role: "admin" });
    mocks.getUserByUsername.mockResolvedValue({ id: "id-1", username: "Oguz", role: "admin", isActive: 1, mustChangePassword: 1 });
    expect((await proxy(request("/api/settings", "GET"))).status).toBe(403);
    expect((await proxy(request("/api/auth/change-password", "POST"))).status).toBe(200);
  });
  it("rejects a wrong password", async () => {
    mocks.verifyLogin.mockResolvedValue(null);
    expect((await POST(request("/api/auth/login", "POST", { username: "Oguz", password: "wrong" }))).status).toBe(401);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });
  it("allows moderator settings writes through to per-user settings scoping", async () => {
    expect((await proxy(request("/api/settings", "POST"))).status).toBe(200);
    expect((await proxy(request("/api/settings", "GET"))).status).toBe(200);
  });
  it("retains legacy password login without users", async () => {
    mocks.hasUsers.mockResolvedValue(false);
    mocks.getSettings.mockResolvedValue({ password: null });
    expect((await POST(request("/api/auth/login", "POST", { password: "123456" }))).status).toBe(200);
  });
  it("exposes only hasUsers in status", async () => {
    expect((await GET()).body.hasUsers).toBe(true);
    mocks.hasUsers.mockResolvedValue(false);
    expect((await GET()).body.hasUsers).toBe(false);
  });
});
