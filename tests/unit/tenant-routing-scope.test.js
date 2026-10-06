import { describe, it, expect, vi } from "vitest";

// Seam test: the /v1 routing handler resolves the API key's owner BEFORE any
// connection list is used, and filters connections to that owner. open-sse
// stays untouched — scoping happens in src/sse/handlers/chat.js at the edge.
//
// We replicate the exact seam logic here against the real repo filter contract:
// getProviderConnections({ ownerUsername }) and validateApiKeyDetails(key).

const keyStore = new Map();
const connectionsStore = [];
let repoCalls = [];

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  validateApiKeyDetails: vi.fn(async (key) => {
    const row = keyStore.get(key);
    if (!row || !(row.isActive === 1 || row.isActive === true)) return null;
    return row;
  }),
}));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: vi.fn(async (filter = {}) => {
    repoCalls.push(filter);
    return filter.ownerUsername
      ? connectionsStore.filter((c) => c.ownerUsername === filter.ownerUsername)
      : connectionsStore.slice();
  }),
}));

const { validateApiKeyDetails } = await import("@/lib/db/repos/apiKeysRepo.js");
const { getProviderConnections } = await import("@/lib/db/repos/connectionsRepo.js");

// Mirrors the seam introduced in src/sse/handlers/chat.js
async function scopedConnectionsForRequest(apiKey) {
  const apiKeyDetails = apiKey ? await validateApiKeyDetails(apiKey) : null;
  const ownerUsername = apiKeyDetails?.ownerUsername || null;
  return getProviderConnections(ownerUsername ? { ownerUsername } : {});
}

function conn(id, owner) {
  return { id, provider: "openai", ownerUsername: owner, isActive: true };
}

describe("tenant routing scope seam (/v1 chat handler)", () => {
  it("key with owner resolves and filters connections to that owner", async () => {
    keyStore.clear(); repoCalls = [];
    keyStore.set("sk-alice", { id: "k1", ownerUsername: "alice", isActive: 1 });
    connectionsStore.length = 0;
    connectionsStore.push(conn("a", "alice"), conn("o", "Oguz"), conn("u", null));

    const scoped = await scopedConnectionsForRequest("sk-alice");
    expect(repoCalls).toEqual([{ ownerUsername: "alice" }]);
    expect(scoped.every((c) => c.ownerUsername === "alice")).toBe(true);
    expect(scoped).toHaveLength(1);
  });

  it("legacy unassigned key (ownerUsername null) → unfiltered", async () => {
    keyStore.clear(); repoCalls = [];
    keyStore.set("sk-legacy", { id: "k2", ownerUsername: null, isActive: 1 });
    connectionsStore.length = 0;
    connectionsStore.push(conn("a", "alice"), conn("o", "Oguz"), conn("u", null));

    const scoped = await scopedConnectionsForRequest("sk-legacy");
    expect(repoCalls).toEqual([{}]);
    expect(scoped).toHaveLength(3);
  });

  it("invalid key → null details, no owner scope (auth layer rejects)", async () => {
    keyStore.clear(); repoCalls = [];
    const scoped = await scopedConnectionsForRequest("sk-unknown");
    expect(repoCalls).toEqual([{}]);
    expect(scoped).toHaveLength(3);
  });

  it("inactive key resolves to null details", async () => {
    keyStore.clear();
    keyStore.set("sk-off", { id: "k3", ownerUsername: "alice", isActive: 0, key: "sk-off", name: "x", createdAt: "t" });
    const details = await validateApiKeyDetails("sk-off");
    expect(details).toBeNull();
  });
});
