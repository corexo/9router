// Validation suite for the dashboard login hardening:
//   S1  successful login (bcrypt hash set, local request) → 200 + session cookie
//   S1b remote login on default password → 403, NO session token issued
//   S2  rate limit: 5 wrong passwords → 401 countdown, 6th → 429 + Retry-After
//   S3  progressive lockout steps 30s → 2m → 10m → 30m across lock cycles
//   S4  IP spoofing: rotating X-Forwarded-For cannot escape the lockout bucket
//       (direct exposure = single "unknown" bucket; TRUST_PROXY=true = per-IP)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  hasUsers: vi.fn(),
  isLocalRequest: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ status: init?.status || 200, body, headers: init?.headers || {} })),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: vi.fn(), delete: vi.fn() })),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, hasUsers: mocks.hasUsers }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: mocks.setDashboardAuthCookie }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: () => false }));
vi.mock("@/lib/auth/saml", () => ({ isSamlConfigured: () => false }));
vi.mock("@/lib/db/repos/authAuditRepo.js", () => ({ recordLoginAttempt: vi.fn() }));

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { recordSuccess } = await import("../../src/lib/auth/loginLimiter.js");
const bcrypt = (await import("bcryptjs")).default;

const GOOD_PW = "S3cret!validation";
const HASH = bcrypt.hashSync(GOOD_PW, 10);

function loginRequest(password, headers = {}) {
  return new Request("http://localhost:20128/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
  });
}

const usedBuckets = new Set();
function resetBucket(ip) { usedBuckets.add(ip); recordSuccess(ip); }

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INITIAL_PASSWORD;
  delete process.env.TRUST_PROXY;
  mocks.getSettings.mockResolvedValue({ password: HASH });
  mocks.hasUsers.mockResolvedValue(false);
  mocks.isLocalRequest.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  // Limiter state is module-global: reset every bucket this suite touched,
  // including the "unknown" default bucket, so tests stay order-independent.
  recordSuccess("unknown");
  for (const ip of usedBuckets) recordSuccess(ip);
  usedBuckets.clear();
});

describe("S1 — successful login", () => {
  it("returns 200 and issues a session cookie for the correct password", async () => {
    const res = await POST(loginRequest(GOOD_PW));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
  });

  it("rejects the wrong password with 401 and issues no session", async () => {
    const res = await POST(loginRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });
});

describe("S1b — default password hardening", () => {
  it("refuses remote logins while the default password is still active (403, no JWT)", async () => {
    mocks.getSettings.mockResolvedValue({ password: null });
    mocks.isLocalRequest.mockReturnValue(false);
    const res = await POST(loginRequest("123456"));
    expect(res.status).toBe(403);
    expect(res.body.mustChangePassword).toBe(true);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });
});

describe("S2 — rate limit trigger (5 fails → lockout)", () => {
  it("answers 4 wrong attempts with a countdown, the 5th locks with 429 + Retry-After", async () => {
    // 5 fails (the 5th triggers the lock — MAX_FAILS_BEFORE_LOCK counts inclusive)
    for (let i = 0; i < 4; i++) {
      const res = await POST(loginRequest("wrong"));
      expect(res.status).toBe(401);
      expect(res.body.remainingBeforeLock).toBe(4 - i);
    }
    const fifth = await POST(loginRequest("wrong"));
    expect(fifth.status).toBe(429);
    expect(Number(fifth.headers["Retry-After"])).toBeGreaterThanOrEqual(25);
    expect(Number(fifth.headers["Retry-After"])).toBeLessThanOrEqual(30);
  });
});

describe("S3 — progressive lockout 30s → 2m → 10m → 30m", () => {
  it("escalates the lock duration across cycles", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const expectLock = (expectedSec) => {
      const res = POST(loginRequest("wrong"));
      return res.then((r) => {
        expect(r.status).toBe(429);
        const ra = Number(r.headers["Retry-After"]);
        expect(ra).toBeGreaterThanOrEqual(expectedSec - 5);
        expect(ra).toBeLessThanOrEqual(expectedSec);
      });
    };
    const drainFive = async () => {
      for (let i = 0; i < 5; i++) await POST(loginRequest("wrong"));
    };

    await drainFive();                      // cycle 1
    await expectLock(30);                   // 6th attempt locked out
    vi.advanceTimersByTime(31_000);         // wait past the 30s lock
    await drainFive();                      // cycle 2
    await expectLock(120);
    vi.advanceTimersByTime(121_000);
    await drainFive();                      // cycle 3
    await expectLock(600);
    vi.advanceTimersByTime(601_000);
    await drainFive();                      // cycle 4
    await expectLock(1800);
  });
});

describe("S4 — IP spoofing", () => {
  it("rotating X-Forwarded-For does NOT escape the lockout (no TRUST_PROXY)", async () => {
    const ips = ["1.2.3.4", "5.6.7.8", "9.10.11.12", "13.14.15.16"];
    for (const ip of ips) {
      const res = await POST(loginRequest("wrong", { "x-forwarded-for": ip }));
      expect(res.status).toBe(401);
    }
    const fifth = await POST(loginRequest("wrong", { "x-forwarded-for": "17.18.19.20" }));
    expect(fifth.status).toBe(429); // every spoofed XFF landed in the single "unknown" bucket
  });

  it("with TRUST_PROXY=true each real client IP keeps its own bucket", async () => {
    process.env.TRUST_PROXY = "true";
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      const res = await POST(loginRequest("wrong", { "x-forwarded-for": ip }));
      expect(res.status).toBe(401); // no lockout bleed-over between IPs
      resetBucket(ip);
    }
  });
});
