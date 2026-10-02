# Feature Registry & Acceptance Criteria

<!-- Sample tasks below. Replace with actual tasks; keep the block format identical. -->

### F-001: Account-Quotas Countdown Extraction
- **Scope:** Extract the module-private `countdown()` function from `src/app/(dashboard)/dashboard/account-quotas/AccountQuotasClient.js` verbatim into a new pure util `src/shared/utils/quotaCountdown.js` (named export `countdown`, no React imports). Swap the component to import it from there. Behavior must not change — `tests/unit/account-quotas-countdown.test.js` is the ground truth.
- **Files Allowed:** `src/shared/utils/quotaCountdown.js` (new), `src/app/(dashboard)/dashboard/account-quotas/AccountQuotasClient.js`
- **Command:** `npm --prefix tests test -- unit/account-quotas-countdown.test.js`
- **Max Retries:** 3
- **Status:** [x]

### F-002: Service Core Business Logic
- **Scope:** Implement business logic function handling domain calculations and collision checks (e.g. routing/account selection in `src/lib/`).
- **Files Allowed:** `src/lib/*`, `src/shared/*`
- **Command:** `npm --prefix tests test -- unit/<name>.test.js`
- **Max Retries:** 3
- **Status:** [ ]

### F-003: API Route Endpoint
- **Scope:** Expose API route handling incoming requests, payload validation, and returning HTTP 201 / 400.
- **Files Allowed:** `src/app/api/**/*`
- **Command:** `npm --prefix tests test -- unit/<name>.test.js`
- **Max Retries:** 3
- **Status:** [ ]

### F-004: Interactive UI Component Action
- **Scope:** Wire button trigger to invoke API handler, handle disabled/loading state, and render inline errors on failure.
- **Files Allowed:** `src/app/**/*`, `src/components/*`
- **Command:** `npm --prefix tests test -- unit/<name>.test.js`
- **Max Retries:** 3
- **Status:** [ ]
