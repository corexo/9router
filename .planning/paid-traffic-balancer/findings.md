# Findings

- Existing weighted account choice lives in `src/sse/services/auth.js` (`dynamicBalanceEnabled`, `weight`, `throttlePercent`).
- Combo provider balancer lives in `open-sse/services/combo.js`; distinguish model-level routing from per-account selection.
- Jev request integration is `src/sse/services/jevRouter.js`; existing traces use `src/lib/jev/requestLog.js`.
- Settings defaults in `src/lib/db/repos/settingsRepo.js`; usage persistence includes `src/lib/db/repos/usageRepo.js`.
- Active session/account pinning must remain intact; account availability/model locks take priority over recommendations.
- No reset endpoints or reset actions are in scope.
