import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("../../src/lib/db/repos/settingsRepo.js", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/lib/db/repos/usageRepo.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status || 200 }) },
}));

const { POST } = await import("../../src/app/api/v1/jev-api/route.js");

function req(body, headers = {}) {
  return new Request("http://localhost/v1/jev-api", { method: "POST", headers, body: JSON.stringify(body) });
}

const question = { questions: { role: { type: "choice", criteria: { a: "A" } } }, state: "hi" };

describe("POST /v1/jev-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_AI_API_KEY;
    mocks.getSettings.mockResolvedValue({ jevApiKey: "central-key" });
  });

  it("proxies with the central key and never leaks it back", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { role: { choice: "a" } }, usage: { total_tokens: 445 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(req(question, { "x-jev-caller": "role-triage" }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("central-key");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer central-key");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("jev-1.13.0");
  });

  it("logs usage with caller, choice and credits", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ answers: { role: { choice: "a" } }, usage: { total_tokens: 445 } }), { status: 200 }));

    await POST(req(question, { "x-jev-caller": "role-triage" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const entry = mocks.saveRequestUsage.mock.calls[0][0];
    expect(entry.provider).toBe("jev");
    expect(entry.tokens.total_tokens).toBe(445);
    expect(entry.meta.caller).toBe("role-triage");
    expect(entry.meta.choice).toBe("a");
    expect(entry.meta.credits).toBeCloseTo(0.000445);
  });

  it("rejects when no key is configured", async () => {
    mocks.getSettings.mockResolvedValue({ jevApiKey: "" });
    const response = await POST(req(question));
    expect(response.status).toBe(400);
  });

  it("returns 504 and logs the failure on timeout", async () => {
    vi.stubGlobal("fetch", async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    const response = await POST(req(question));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(504);
    expect(mocks.saveRequestUsage.mock.calls[0][0].meta.fallbackReason).toBe("timeout");
  });
});
