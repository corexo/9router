# Failure Patterns — was nicht funktioniert

Bekannte Anti-Patterns, strukturiert erfasst mit `failures_record`. Vor riskanten Aktionen mit `failures_check` abgleichen.

## F-056 — Worktree creation assumes develop branch
- Datum: 2026-09-27 · Projekt: Pirouter · Agent: main
- Muster: git_worktree_create base develop fails invalid reference develop
- Warum es fehlschlägt: Repository has no local develop ref; helper defaults to develop regardless of actual branch setup.
- Richtig stattdessen: Inspect git context/current refs using git_context or ask coordinator; retry with existing valid base branch, without editing shared checkout.

## F-073 — edit tool did not find requested block due to stale content
- Datum: 2026-09-29 · Projekt: Pirouter · Agent: main
- Muster: functions.edit oldText mismatch stale read subsequent changes
- Warum es fehlschlägt: The file changed since the referenced excerpt (prior ongoing dirty work / earlier edits), leading to stale assumptions and missed exact replacement.
- Richtig stattdessen: Read the precise current lines directly before targeted edit; avoid duplicate no-op edit attempts.

## F-074 — Jev enriched-criteria test mocks need all injected data providers
- Datum: 2026-09-30 · Projekt: Pirouter · Agent: main
- Muster: selectJevModel enrichCriteria true getModelHealth mocked but getProviderConnections/getUsageStats omitted
- Warum es fehlschlägt: buildEnrichedCriteria invokes optional providers and then reads connections.filter and stats.byModel; missing mocks throw before fetch and obscure payload assertions.
- Richtig stattdessen: Provide getProviderConnections: async () => [] and getUsageStats: async () => ({byModel:{},byProvider:{}}) in enriched Jev test mocks.

## F-075 — 9router settings: direct DB write lost to app in-memory overwrite
- Datum: 2026-09-30 · Projekt: Pirouter · Agent: main
- Muster: direct sqlite UPDATE on live 9router settings row then docker restart
- Warum es fehlschlägt: The app keeps settings in memory and persists its own snapshot on save/shutdown, clobbering out-of-band sqlite writes; the DB read is also stale relative to live app state.
- Richtig stattdessen: Change settings only through the app: PUT /api/settings with a session, or dashboard Jev-Pool JSON import + Speichern. Never edit the settings row directly while the container runs.

## F-079 — Kanban board unauthenticated
- Datum: 2026-09-30 · Projekt: Pirouter · Agent: main
- Muster: kanban_board 401 project task tracking
- Warum es fehlschlägt: Kanban backend rejects this project's board request with 401, preventing work tracking.
- Richtig stattdessen: Continue with repository planning files instead of retrying Kanban unless auth is restored.

## F-087 — Docker redeploy verification endpoint rejects API-key requests
- Datum: 2026-09-30 · Projekt: Pirouter · Agent: main
- Muster: docker compose up -d redeploy LLM API /v1/models verification HTTP 401 middleware dashboardGuard Next
- Warum es fehlschlägt: The deployed app's real API guard returns 401 on /v1/models without a valid persisted database API key; guessed/dev key auth is not a valid smoke test, and inspecting API-key DB fields is prohibited.
- Richtig stattdessen: Verify container READY/status/restart count and logs; use an approved existing client auth route without exposing credentials, or ask for dashboard-based validation. Do not inspect key values or weaken API security.

## F-095 — Hermes QNAP editable source is not the running install
- Datum: 2026-10-02 · Projekt: Pirouter · Agent: main
- Muster: QNAP hermes-qnap /opt/data/hermes-agent patch import test /opt/hermes
- Warum es fehlschlägt: Container runtime imports agent modules from /opt/hermes, while /opt/data/hermes-agent is a separate mounted source checkout; editing it does not affect the running service.
- Richtig stattdessen: Verify module __file__ inside hermes-qnap after edits. Patch or overlay /opt/hermes for immediate runtime changes; add a volume-backed startup overlay for persistence across container recreation.

## F-096 — Param-support regression suite contains unrelated Cloudflare capability failure
- Datum: 2026-10-02 · Projekt: Pirouter · Agent: main
- Muster: tests/unit/param-support.test.js full file run fails Cloudflare Workers AI context window expected 32768 received 1000000
- Warum es fehlschlägt: The test file mixes parameter stripping tests with a pre-existing/independent capability assertion; the GLM cache-field test itself passes.
- Richtig stattdessen: Run or report the specific failing assertion separately; validate the changed GLM test by name and run its dedicated targeted suite. Do not claim full param-support file green until Cloudflare capability mapping is fixed.

## F-097 — QNAP SSH alias not resolvable from PiRouter host
- Datum: 2026-10-03 · Projekt: Pirouter · Agent: main
- Muster: ssh hermes-qnap returns Could not resolve hostname
- Warum es fehlschlägt: The known QNAP container name/label is not an SSH host alias in this environment.
- Richtig stattdessen: Request the QNAP LAN IP/hostname or inspect SSH config for a verified host alias before remote deployment.

## F-098 — QNAP Docker Compose wrapper ignores compose subcommand options
- Datum: 2026-10-03 · Projekt: Pirouter · Agent: main
- Muster: QNAP Container Station docker compose -f fails unknown shorthand flag -f
- Warum es fehlschlägt: The QNAP Docker wrapper exposes compose differently or does not forward compose plugin options.
- Richtig stattdessen: Use explicit docker network/create/run commands for the isolated deployment, or verify the QNAP-supported compose entrypoint before relying on compose files.

## F-099 — QNAP Container Station rejects custom Docker bridge network NAT rule
- Datum: 2026-10-03 · Projekt: Pirouter · Agent: main
- Muster: docker network create fails qnetwork-tool NetworkService.firewall.nat.AddNATrule
- Warum es fehlschlägt: QNAP virtual-switch firewall cannot create a new custom bridge/NAT rule in current network state.
- Richtig stattdessen: Run the isolated test container on the existing default bridge; omit optional headroom because it is disabled by default.

## F-115 — ESM tool resolution ignores NODE_PATH in isolated worktree
- Datum: 2026-10-05 · Projekt: Pirouter · Agent: main
- Muster: eslint vitest worktree no node_modules NODE_PATH ESM ERR_MODULE_NOT_FOUND
- Warum es fehlschlägt: ESM imports in eslint/vitest configs resolve relative to config location; NODE_PATH does not participate in ESM resolution.
- Richtig stattdessen: Install dependencies in the isolated worktree or use a temporary symlink to the existing node_modules, then remove the symlink after checks.

## F-116 — PiRouter feature worktree base imports untracked modules
- Datum: 2026-10-05 · Projekt: Pirouter · Agent: main
- Muster: Next build webpack Cannot resolve jevContext paidTrafficBalancer isolated worktree from remove-hermes-integration
- Warum es fehlschlägt: Tracked chat.js imports modules present only as untracked files in shared checkout; git worktree omits them, so build cannot compile independently.
- Richtig stattdessen: Complete/commit missing dependent work on base branch before full build, or explicitly isolate a valid baseline including those modules; do not copy unrelated untracked files into task branch.

## F-117 — PiRouter protected test-suite hook blocks feature commit
- Datum: 2026-10-05 · Projekt: Pirouter · Agent: main
- Muster: git commit protected files tests/unit/session-cache-registry.test.js test suites read-only
- Warum es fehlschlägt: Repository pre-commit policy forbids modifying test suites, even when the focused test passed; git_safe_commit reports success without creating a commit in this state.
- Richtig stattdessen: Do not bypass the hook. Keep tested changes in isolated worktree; obtain explicit authorization/policy change or remove test changes only if user approves reducing test coverage, then verify actual HEAD/status after commit.

## F-118 — QNAP Docker CLI unavailable over SSH
- Datum: 2026-10-05 · Projekt: Pirouter · Agent: main
- Muster: Pirouter deploy QNAP SSH hostname reachable but remote `docker` command returns not found
- Warum es fehlschlägt: QNAP SSH account's PATH does not include docker CLI; remote docker ps exits 127 despite valid host alias and SSH connectivity.
- Richtig stattdessen: Inspect QNAP deployment documentation/scripts and NAS container management interfaces; discover verified Docker CLI path or supported deploy method before attempting deployment. Never assume compose/docker is available through SSH account PATH.

## F-119 — QNAP Docker binary discovery full-filesystem scan times out
- Datum: 2026-10-05 · Projekt: Pirouter · Agent: main
- Muster: SSH QNAP deployment find / -name docker
- Warum es fehlschlägt: Scanning the NAS root filesystem over SSH exceeded the command timeout and is too broad for remote target inspection.
- Richtig stattdessen: Restrict searches to known Container Station package paths; inspect QTS container metadata/config or published deployment instructions rather than recursively walking `/`.

## F-125 — PiRouter protected test hook blocks necessary session-cache whitelist regression update
- Datum: 2026-10-05 · Projekt: Pirouter · Agent: main
- Muster: PiRouter pre-commit protected tests/unit/session-cache-registry.test.js field whitelist changed by new piProjectPath, commit rejected
- Warum es fehlschlägt: Repository feature-registry pre-commit policy treats test suites as read-only; legitimate test correction cannot be committed while test expects obsolete fields.
- Richtig stattdessen: Keep test fix staged in isolated integration worktree, validate there; seek explicit policy change/authorized path instead of bypassing hook or dropping coverage.

## F-130 — QNAP remote shell quote mismatch aborts stop command
- Datum: 2026-10-05 · Projekt: Pirouter · Agent: main
- Muster: ssh qnap inline shell with nested single quotes and jq/ls
- Warum es fehlschlägt: Outer local shell consumed an unmatched quote before SSH, so no remote action executed.
- Richtig stattdessen: Use a heredoc or double-quoted remote command; validate locally with bash -n before executing destructive operations.
