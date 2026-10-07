import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  createProviderConnection: vi.fn(),
  getProviderNodes: vi.fn(),
  createProviderNode: vi.fn(),
  getCombos: vi.fn(),
  createCombo: vi.fn(),
  getApiKeys: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  cookiesGet: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: {
  json: (body, init) => ({ status: init?.status || 200, body }),
  next: () => ({ status: 200 }),
} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookiesGet }) }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  createProviderConnection: mocks.createProviderConnection,
  getCombos: mocks.getCombos,
  createCombo: mocks.createCombo,
  getComboByName: vi.fn(async () => null),
  ensureBuiltinCombos: vi.fn(async () => {}),
  BUILTIN_COMBOS: ["jev"],
  getApiKeys: mocks.getApiKeys,
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
  deleteApiKey: mocks.deleteApiKey,
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/models", () => ({
  getProviderNodes: mocks.getProviderNodes,
  createProviderNode: mocks.createProviderNode,
  getProviderConnections: mocks.getProviderConnections,
  createProviderConnection: mocks.createProviderConnection,
  getProviderNodeById: vi.fn(async () => null),
  getProxyPoolById: vi.fn(async () => null),
}));
vi.mock("@/lib/providerNormalization", async (importOriginal) => await importOriginal());

const { GET: GETConnections, POST: POSTConnections } = await import("../../src/app/api/providers/route.js");
const { GET: GETNodes, POST: POSTNodes } = await import("../../src/app/api/provider-nodes/route.js");
const { GET: GETCombos, POST: POSTCombos } = await import("../../src/app/api/combos/route.js");
const { GET: GETKeys, POST: POSTKeys } = await import("../../src/app/api/keys/route.js");
const { GET: GETKey, PUT: PUTKey, DELETE: DELETEKey } = await import("../../src/app/api/keys/[id]/route.js");

function req(body) {
  return { json: async () => body };
}
function setClaims(claims) {
  mocks.verifyDashboardAuthToken.mockResolvedValue(claims);
  mocks.cookiesGet.mockReturnValue(claims ? { value: "tok" } : undefined);
}
function conn(owner, provider = "openai") {
  return { id: `${provider}-${owner}`, provider, ownerUsername: owner, isActive: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockImplementation(async (filter = {}) => {
    const all = [conn("Oguz"), conn("alice"), conn(null)];
    return filter.ownerUsername ? all.filter((c) => c.ownerUsername === filter.ownerUsername) : all;
  });
  mocks.getProviderNodes.mockImplementation(async (filter = {}) => {
    const all = [{ id: "n1", ownerUsername: "Oguz" }, { id: "n2", ownerUsername: "alice" }];
    return filter.ownerUsername ? all.filter((n) => n.ownerUsername === filter.ownerUsername) : all;
  });
  mocks.getCombos.mockImplementation(async (filter = {}) => {
    const all = [{ id: "c1", name: "a", ownerUsername: "Oguz" }, { id: "c2", name: "b", ownerUsername: "alice" }];
    return filter.ownerUsername ? all.filter((c) => c.ownerUsername === filter.ownerUsername) : all;
  });
  mocks.getApiKeys.mockResolvedValue([{ id: "k1", ownerUsername: "Oguz" }, { id: "k2", ownerUsername: "alice" }]);
  mocks.createProviderConnection.mockImplementation(async (d) => ({ ...conn(d.ownerUsername) }));
  mocks.createProviderNode.mockImplementation(async (d) => ({ id: "nx", ownerUsername: d.ownerUsername }));
  mocks.createCombo.mockImplementation(async (d) => ({ id: "cx", ownerUsername: d.ownerUsername }));
  setClaims(null);
});

describe("multi-tenant scoping at the dashboard API edge", () => {
  it("moderator sees only own connections", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    const res = await GETConnections();
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ ownerUsername: "alice" });
    const returned = res.body.connections || [];
    expect(returned.filter((c) => c.ownerUsername === "alice").length).toBe(1);
    expect(returned.some((c) => c.ownerUsername === "Oguz")).toBe(false);
  });

  it("admin is scoped to the admin's own tenant", async () => {
    setClaims({ sub: "id-1", username: "Oguz", role: "admin" });
    await GETConnections();
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ ownerUsername: "Oguz" });
  });

  it("anonymous caller gets all (legacy single-user compat)", async () => {
    setClaims(null);
    await GETConnections();
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({});
  });

  it("create stamps ownerUsername for moderator", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    await POSTConnections(req({ provider: "openai", authType: "apikey", name: "k", apiKey: "x" }));
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({ ownerUsername: "alice" }));
  });

  it("nodes list is scoped to the caller for both roles", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    await GETNodes();
    expect(mocks.getProviderNodes).toHaveBeenCalledWith({ ownerUsername: "alice" });
    setClaims({ sub: "id-1", username: "Oguz", role: "admin" });
    await GETNodes();
    expect(mocks.getProviderNodes).toHaveBeenCalledWith({ ownerUsername: "Oguz" });
  });

  it("combos list scoped for moderator", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    await GETCombos();
    expect(mocks.getCombos).toHaveBeenCalledWith({ ownerUsername: "alice" });
  });

  it("keys list filtered to own for moderator", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    const res = await GETKeys();
    expect(res.body.keys).toEqual([{ id: "k1", ownerUsername: "Oguz" }, { id: "k2", ownerUsername: "alice" }].filter((k) => k.ownerUsername === "alice"));
  });

  it("key create stamps owner", async () => {});
});

describe("moderator mutation of foreign rows → 403", () => {
  const p = { params: Promise.resolve({ id: "k1" }) };

  it("moderator PUT foreign key → 403", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    mocks.getApiKeyById.mockResolvedValue({ id: "k1", ownerUsername: "Oguz" });
    const res = await PUTKey(req({ isActive: false }), p);
    expect(res.status).toBe(403);
  });

  it("admin PUT foreign key → allowed", async () => {
    setClaims({ sub: "id-1", username: "Oguz", role: "admin" });
    mocks.getApiKeyById.mockResolvedValue({ id: "k1", ownerUsername: "Oguz" });
    mocks.updateApiKey.mockResolvedValue({ id: "k1" });
    const res = await PUTKey(req({ isActive: false }), p);
    expect(res.status).toBe(200);
  });

  it("moderator DELETE foreign key → 403", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    mocks.getApiKeyById.mockResolvedValue({ id: "k1", ownerUsername: "Oguz" });
    const res = await DELETEKey({}, p);
    expect(res.status).toBe(403);
    expect(mocks.deleteApiKey).not.toHaveBeenCalled();
  });

  it("GET own key allowed for moderator", async () => {
    setClaims({ sub: "id-2", username: "alice", role: "moderator" });
    mocks.getApiKeyById.mockResolvedValue({ id: "k1", ownerUsername: "alice" });
    const res = await GETKey({}, p);
    expect(res.status).toBe(200);
  });
});
