import { describe, it, expect, vi, beforeEach } from "vitest";

// userPrefs whitelist: only UI, Jev, and token-saver preferences persist; anything
// else is dropped silently (never rejected — dashboard must not break).

const rows = new Map();

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({
    get: (sql, params) => (rows.has(params[0]) ? { data: rows.get(params[0]) } : undefined),
    run: (sql, params) => rows.set(params[0], params[1]),
  })),
}));

const { getUserPrefs, updateUserPrefs } = await import("../../src/lib/db/repos/userPrefsRepo.js");

beforeEach(() => rows.clear());

describe("userPrefs whitelist", () => {
  it("stores whitelisted keys", async () => {
    await updateUserPrefs("alice", { theme: "dark", locale: "de", dashboardLayout: { cols: 2 } });
    const prefs = await getUserPrefs("alice");
    expect(prefs).toEqual({ theme: "dark", locale: "de", dashboardLayout: { cols: 2 } });
  });

  it("stores per-user token-saver settings", async () => {
    await updateUserPrefs("alice", { rtkEnabled: false, headroomEnabled: true, cavemanEnabled: true, ponytailLevel: "lite" });
    expect(await getUserPrefs("alice")).toMatchObject({ rtkEnabled: false, headroomEnabled: true, cavemanEnabled: true, ponytailLevel: "lite" });
  });

  it("drops non-whitelisted keys", async () => {
    await updateUserPrefs("alice", { theme: "dark", isAdmin: true, settings: "{}" });
    const prefs = await getUserPrefs("alice");
    expect(prefs).toEqual({ theme: "dark" });
    expect("isAdmin" in prefs).toBe(false);
  });

  it("merges with existing prefs (partial update)", async () => {
    await updateUserPrefs("alice", { theme: "dark", locale: "en" });
    await updateUserPrefs("alice", { theme: "light" });
    const prefs = await getUserPrefs("alice");
    expect(prefs).toEqual({ theme: "light", locale: "en" });
  });

  it("empty prefs for unknown user", async () => {
    expect(await getUserPrefs("nobody")).toEqual({});
  });

  it("per-user isolation", async () => {
    await updateUserPrefs("alice", { theme: "dark" });
    await updateUserPrefs("bob", { theme: "light" });
    expect(await getUserPrefs("alice")).toEqual({ theme: "dark" });
    expect(await getUserPrefs("bob")).toEqual({ theme: "light" });
  });
});
