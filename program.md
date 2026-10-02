# Program Specifications & Agent Operating Boundaries

## 1. Environment & Stack Baseline
- Runtime / Engine: Node.js v24 (>= 18 required by tests)
- Package Manager: npm (root app + separate `tests/` and `cli/` packages)
- Primary Framework: Next.js 16 (custom server via `custom-server.js`, dev port 20127)
- Test Framework: Vitest 4 (lives in `tests/`, own `package.json` — run with `npm --prefix tests test -- <path>`)
- Language: Plain JavaScript (jsconfig.json, no TypeScript) — there is no `tsc` gate

## 2. Quality Pipeline Order
Every feature run must execute gates in this strict order:
1. Linting: `npx eslint <changed files>` (eslint 9 + eslint-config-next installed)
2. Feature Test: `npm --prefix tests test -- <test path from features.md>`

Note: the full suite (`npm --prefix tests test`) covers 250+ files (~minutes). Prefer the
per-task file filter from the task block; run the full suite only before final handoff.

## 3. Strict Operating Boundaries ("What You Cannot Do")
1. **TEST IMMUTABILITY:** You are strictly forbidden from modifying, disabling, or deleting test files or assertion statements to make checks pass. Tests define the ground truth. If a check fails, the bug is inside your implementation code.
2. **CONFIGURATION LOCK:** Never modify `program.md`, build scripts (`next.config.mjs`, `custom-server.js`, `scripts/`), or core runtime configurations unless explicitly requested in the active task scope.
3. **NO DEPENDENCY EXPANSION:** Never install third-party packages or modify lockfiles/dependencies without explicit permission.
4. **SINGLE-TASK EXECUTION:** Work exclusively on one task at a time. Do not touch or refactor unrelated files.
5. **ZERO FAKE COMPLETES:** Never mark a task as completed `[x]` unless all verification gates exit with status code `0`.

## 4. The Experiment Loop
Follow this execution cycle sequentially:

```
[Select Task]     --> Read next pending [ ] task in features.md
│
▼
[Context Check]   --> Review rules and constraints in program.md
│
▼
[Implementation]  --> Write minimal required application code
│
▼
[Run Checks]      --> Run eslint on changed files -> Task Test Command
│
├──> FAIL (Attempt < 3):
│       Analyze failure logs, modify source code, re-run checks.
│
├──> FAIL (Attempt >= 3):
│       Run `git stash push --include-untracked` (recoverable, never hard-restore).
│       Set task status to [FAILED] in features.md.
│       Document the exact error and stop execution.
│
└──> SUCCESS (Exit Code 0):
        Update task status to [x] in features.md.
        Stage verified files and commit with message:
        "feat(core): implement <task-id>: <short title>"
```
