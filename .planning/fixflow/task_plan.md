# Aufgabenplan: fixflow — wiederholbarer Fix-Workflow für 9router

## Ziel
Fix-Workflow (fixflow) für 9router etabliert und mit der planning-with-files-Infrastruktur valide: Melden → Plan anlegen (`.planning/<name>/`) → Fix im Worktree → Validieren → Fortschritt dokumentieren.

## Nächster Schritt
Ersten reellen Bug über fixflow abwickeln (Phase 4) oder Plan archivieren.

## Aktuelle Phase
Phase 3

## Phasen

### Phase 1: Planungs-Setup
- [x] `.planning/fixflow/` angelegt (init-session.sh, v3.20.5)
- [x] task_plan.md, findings.md, progress.md befüllt
- **Status:** done

### Phase 2: Infrastruktur validieren
- [x] `plan-doctor.sh` aus Projektroot ausführen (Resolution, Injection, Latenz)
- [x] `resolve-plan-dir.sh` findet `.planning/fixflow/` als aktiven Plan
- **Status:** done

### Phase 3: Fix-Workflow festlegen
- [x] Ablauf dokumentiert in `.planning/fixflow/fixflow.md`
- [x] 2-Action-Regel und 3-Strike-Protokoll verankert
- **Status:** done

### Phase 4: Abnahme
- [ ] Erster reeller Fix über den Workflow abgewickelt (zurückgestellt, ponytail — wartet auf echten Bug)
- [ ] Abschlusszusammenfassung für Benutzer
- **Status:** pending

## Schlüsselfragen
- Soll fixflow ins Projekt-README/docs? (noch offen)
