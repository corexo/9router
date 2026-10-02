// Ground truth for the /dashboard/account-quotas countdown logic.
// The function lives in src/shared/utils/quotaCountdown.js — extracted verbatim
// from AccountQuotasClient.js. Behavior contract (no behavior change allowed):
//   - no date            -> "Kein Zeitfenster gemeldet"
//   - unparseable date   -> "Zeitfenster unbekannt"
//   - now or past        -> "Abgelaufen / Reset fällig"
//   - < 60 min           -> "Reset in N Min." (minutes rounded UP via ceil)
//   - < 24 h             -> "Reset in H Std. M Min."
//   - >= 24 h            -> "Reset in D Tg. H Std."
import { describe, expect, it } from "vitest";
import { countdown } from "../../src/shared/utils/quotaCountdown.js";

const NOW = Date.parse("2025-06-01T12:00:00Z");
const MIN = 60_000;

describe("countdown — account-quotas reset window", () => {
  it("reports missing dates", () => {
    expect(countdown(undefined, NOW)).toBe("Kein Zeitfenster gemeldet");
    expect(countdown(null, NOW)).toBe("Kein Zeitfenster gemeldet");
  });

  it("reports unparseable dates", () => {
    expect(countdown("not-a-date", NOW)).toBe("Zeitfenster unbekannt");
  });

  it("flags expired windows at or below now", () => {
    expect(countdown(new Date(NOW - 1).toISOString(), NOW)).toBe("Abgelaufen / Reset fällig");
    expect(countdown(new Date(NOW).toISOString(), NOW)).toBe("Abgelaufen / Reset fällig");
  });

  it("rounds sub-minute windows up to 1 minute", () => {
    expect(countdown(new Date(NOW + 30_000).toISOString(), NOW)).toBe("Reset in 1 Min.");
    expect(countdown(new Date(NOW + 59 * MIN).toISOString(), NOW)).toBe("Reset in 59 Min.");
  });

  it("formats hours below 24h as hours and minutes", () => {
    expect(countdown(new Date(NOW + 60 * MIN).toISOString(), NOW)).toBe("Reset in 1 Std. 0 Min.");
    expect(countdown(new Date(NOW + 90 * MIN).toISOString(), NOW)).toBe("Reset in 1 Std. 30 Min.");
    expect(countdown(new Date(NOW + 23 * 60 * MIN + 59 * MIN).toISOString(), NOW)).toBe(
      "Reset in 23 Std. 59 Min."
    );
  });

  it("formats days at or above 24h", () => {
    expect(countdown(new Date(NOW + 24 * 60 * MIN).toISOString(), NOW)).toBe("Reset in 1 Tg. 0 Std.");
    expect(countdown(new Date(NOW + 3 * 24 * 60 * MIN + 5 * 60 * MIN).toISOString(), NOW)).toBe(
      "Reset in 3 Tg. 5 Std."
    );
  });
});
