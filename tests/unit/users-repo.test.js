import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() }));
vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => mocks }));
const { createUser, verifyLogin, listUsers } = await import("../../src/lib/db/repos/usersRepo.js");

// Adapter mock keeps the password hash in memory; no real database or credentials.
describe("users repo", () => {
  it("creates bcrypt hashes, verifies passwords, excludes hashes from public results", async () => {
    let row;
    mocks.run.mockImplementation((sql, args) => {
      if (sql.startsWith("INSERT")) row = { id: args[0], username: args[1], passwordHash: args[2], role: args[3], isActive: args[4], createdAt: args[5] };
    });
    mocks.get.mockImplementation(() => row);
    mocks.all.mockImplementation(() => [{ id: row.id, username: row.username, role: row.role, isActive: row.isActive, createdAt: row.createdAt }]);
    const user = await createUser("Oguz", "test-password", "moderator");
    expect(user).not.toHaveProperty("passwordHash");
    expect(row.passwordHash).not.toBe("test-password");
    expect(await verifyLogin("Oguz", "test-password")).not.toHaveProperty("passwordHash");
    expect(await verifyLogin("Oguz", "wrong")).toBeNull();
    expect(await listUsers()).not.toEqual(expect.arrayContaining([expect.objectContaining({ passwordHash: row.passwordHash })]));
  });
});
