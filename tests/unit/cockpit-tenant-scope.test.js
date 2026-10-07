import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCockpitData: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/usageDb", () => ({ getCockpitData: mocks.getCockpitData }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }));

const { GET } = await import("../../src/app/api/dashboard/cockpit/route.js");

describe("Cockpit tenant scoping", () => {
  it("passes moderator owner into the aggregate query", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "session" }) });
    mocks.verifyDashboardAuthToken.mockResolvedValue({ username: "Ugur", role: "moderator" });
    mocks.getCockpitData.mockResolvedValue({ accounts: [] });
    const response = await GET(new Request("http://localhost/api/dashboard/cockpit?period=7d"));
    expect(response.status).toBe(200);
    expect(mocks.getCockpitData).toHaveBeenCalledWith("7d", "Ugur");
  });

  it("scopes the admin Cockpit to the admin's own tenant", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "session" }) });
    mocks.verifyDashboardAuthToken.mockResolvedValue({ username: "Oguz", role: "admin" });
    mocks.getCockpitData.mockResolvedValue({ accounts: [] });
    await GET(new Request("http://localhost/api/dashboard/cockpit?period=7d"));
    expect(mocks.getCockpitData).toHaveBeenCalledWith("7d", "Oguz");
  });
});
