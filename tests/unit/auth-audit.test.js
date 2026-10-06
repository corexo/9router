import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ all: vi.fn(), run: vi.fn() }));
vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: vi.fn(async () => ({ all: mocks.all, run: mocks.run })) }));

const { listLoginAudit, recordLoginAttempt } = await import("../../src/lib/db/repos/authAuditRepo.js");

describe("login IP audit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists outcome, username, source IP and user agent", async () => {
    await recordLoginAttempt({ username: "Ugur", sourceIp: "192.0.2.4", success: false, userAgent: "test-agent" });
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[0][0]).toContain("INSERT INTO authLoginAudit");
    expect(mocks.run.mock.calls[0][1]).toEqual(["Ugur", "192.0.2.4", 0, "test-agent", expect.any(String)]);
    expect(mocks.run.mock.calls[1][0]).toContain("DELETE FROM authLoginAudit");
  });

  it("lists only the requested username when scoped", async () => {
    mocks.all.mockReturnValue([]);
    await listLoginAudit({ username: "Ugur", limit: 10 });
    expect(mocks.all.mock.calls[0][0]).toContain("WHERE username = ?");
    expect(mocks.all.mock.calls[0][1]).toEqual(["Ugur", 10]);
  });
});
