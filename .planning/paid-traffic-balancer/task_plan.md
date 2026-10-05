# Paid Traffic Balancer

## Goal
Replace current weighted account traffic selection for paid models with Jev-driven dynamic distribution. Log outgoing Jev requests/responses and render usage as a dashboard chart. Exclude free models. Never perform resets; preserve existing uncommitted changes.

## Steps
- [ ] Trace provider/account selection, paid/free identification, usage/reset sources, and existing request logging.
- [ ] Implement Jev recommendation refresh gated on changed usage and 10-minute minimum interval; preserve session pins and availability/lock checks.
- [ ] Persist request/response and usage snapshots; add dedicated chart/log page.
- [ ] Add focused tests; run lint/build and inspect targeted diff.

## Constraints
- No resets; no re-pinning active sessions.
- Recompute only when usage changes, and at least 10 minutes since last Jev request.
- Preserve pre-existing working-tree modifications.
