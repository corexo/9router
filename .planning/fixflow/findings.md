# Erkenntnisse: fixflow

## 2026-09-23
- Skill planning-with-files-de v3.20.5 global in Pi installiert (`~/.pi/agent/skills/planning-with-files-de/`); Claude-Lifecycle-Hooks laufen nicht in Pi, Ersatz = AGENTS.md-Regel „Complex-task planning" (deterministischer Trigger).
- Planverzeichnis: `.planning/fixflow/` — Resolution via `scripts/resolve-plan-dir.sh`: 1. `$PLAN_ID`, 2. `.planning/.active_plan`, 3. neuester Ordner nach mtime, 4. Legacy `./task_plan.md`.
- Worktree-Guard blockt Schreibzugriffe im Haupt-Checkout; `.planning/` als untracked Metadaten vom Benutzer als Ausnahme freigegeben.
