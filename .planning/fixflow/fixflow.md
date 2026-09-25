# fixflow — Fix-Workflow für 9router

Wiederholbarer Ablauf pro Bug/Fix:

1. **Melden** — Bug benennen; Plan anlegen: `sh ~/.pi/agent/skills/planning-with-files-de/scripts/init-session.sh <fix-name>` in `.planning/<fix-name>/`, Ziel + Phasen in `task_plan.md` füllen.
2. **Kontext** — 2-Action-Regel: nach je 2 Aktionen `findings.md`/`progress.md` aktualisieren. Vor Entscheidung: Dateien lesen (Read-before-Decide).
3. **Fixen** — Worktree-Pflicht: `git_worktree_create`, nie im Haupt-Checkout. Alle Fehler sofort in `findings.md` loggen; 3-Strike-Protokoll: 3 Fehlversuche gleicher Ansatz = Ansatz wechseln.
4. **Validieren** — Tests/Lint im Worktree, Ergebnisse in `progress.md`.
5. **Abschließen** — Merge via `git_worktree_merge`, Plan-Ordner bleibt als Historie in `.planning/`.

Regeln: nie denselben fehlgeschlagenen Fix wiederholen; nach Abschluss eine Phase weiter (`task_plan.md` Status); Session-Neustart = `resolve-plan-dir.sh` + Plandateien lesen statt Raten.
