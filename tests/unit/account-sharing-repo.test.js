import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";

const holder = vi.hoisted(() => ({ adapter: null }));
vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => holder.adapter }));

const { getProviderConnections, getProviderConnectionForUser, createProviderConnection } = await import("../../src/lib/db/repos/connectionsRepo.js");
const SQL = await initSqlJs();

function createAdapter() {
  const raw = new SQL.Database();
  const adapter = {
    exec: (sql) => raw.run(sql),
    run: (sql, params = []) => { raw.run(sql, params); return { changes: raw.getRowsModified() }; },
    get: (sql, params = []) => {
      const stmt = raw.prepare(sql); stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free(); return row;
    },
    all: (sql, params = []) => {
      const stmt = raw.prepare(sql); stmt.bind(params);
      const rows = []; while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free(); return rows;
    },
    transaction: (fn) => {
      raw.run("BEGIN");
      try { const result = fn(); raw.run("COMMIT"); return result; }
      catch (error) { raw.run("ROLLBACK"); throw error; }
    },
  };
  raw.run(`CREATE TABLE providerConnections (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, authType TEXT NOT NULL, name TEXT,
    email TEXT, priority INTEGER, isActive INTEGER, ownerUsername TEXT,
    isShared INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`);
  return adapter;
}

beforeEach(() => {
  holder.adapter = createAdapter();
  for (const [id, owner, shared] of [["private-oguz", "Oguz", 0], ["shared-oguz", "Oguz", 1], ["own-ugur", "Ugur", 0]]) {
    holder.adapter.run(
      "INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,ownerUsername,isShared,data,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, "glm", "apikey", "Main", 1, 1, owner, shared, "{}", "2026-10-07", "2026-10-07"]
    );
  }
});

describe("provider account ownership/sharing", () => {
  it("shows owner and explicitly shared accounts, never a private foreign account", async () => {
    const ids = (await getProviderConnections({ ownerUsername: "Ugur" })).map((connection) => connection.id);
    expect(ids).toEqual(expect.arrayContaining(["shared-oguz", "own-ugur"]));
    expect(ids).not.toContain("private-oguz");
    expect(await getProviderConnectionForUser("private-oguz", "Ugur")).toBeNull();
    expect((await getProviderConnectionForUser("shared-oguz", "Ugur"))?.isShared).toBe(true);
    expect((await getProviderConnectionForUser("shared-oguz", "Ugur", { ownerOnly: true }))).toBeNull();
  });

  it("does not deduplicate Ugur's new connection into Oguz's same-name account", async () => {
    const own = await createProviderConnection({ provider: "glm", authType: "apikey", name: "Main", ownerUsername: "Ugur" });
    expect(own.id).not.toBe("private-oguz");
    expect(own.id).not.toBe("shared-oguz");
    expect((await getProviderConnectionForUser("private-oguz", "Oguz"))?.ownerUsername).toBe("Oguz");
  });
});
