# PiRouter QNAP Blue/Green Deployment

PiRouter läuft auf `192.168.10.40:9311`. `scripts/deploy-qnap.sh` nutzt Blue/Green über einen stabilen Nginx-Ingress; `scripts/deploy-qnap-legacy.sh` bleibt als ausdrücklich unterbrechender Notfallpfad erhalten.

## Erstmaliger Bootstrap

Der aktuelle Container bindet `9311` direkt. Beim einmaligen Wechsel zum Ingress muss diese Listener-Belegung übergeben werden; der Nutzer hat eine kurze einmalige Unterbrechung dafür genehmigt. Vorher baut/testet das Script das neue Image, prüft den Green-Container auf einem loopback-only Port und führt einen SQLite-Online-Backup zur externen Platte aus.

```bash
./scripts/deploy-qnap.sh --status
./scripts/deploy-qnap.sh --bootstrap
```

Bootstrap-Reihenfolge:
1. Lokaler Docker-Build + interner `/api/health` Smoke-Test.
2. Image-Transfer zur QNAP.
3. Online-Backup via `better-sqlite3.backup()` nach `/share/external/DEV3304_1/9router-backups` (kein Dateikopieren der aktiven WAL-DB).
4. Green startet intern auf loopback-Port `9322`; Blue bleibt live auf `9311`.
5. Host-network Nginx-Ingress wird zuerst nur am Docker-Bridge-Gateway auf Port `9312` geprüft; bestehender HTTPS-Nginx wird auf den Canary-Ingress umgeschaltet.
6. Einmaliger kurzer Listener-Handoff von direktem Blue `:9311` auf den Ingress `:9311`; Health-Prüfung, danach externe Nginx-Upstream auf den stabilen Ingress.
7. Zustand in `data-home/ingress/state.env`; alter Image-Tag bleibt als Rollback-Basis erhalten.

## Zukünftige Deployments

```bash
./scripts/deploy-qnap.sh --status
./scripts/deploy-qnap.sh --skip-e2e
./scripts/deploy-qnap.sh --rollback
```

- Blue/Green App-Slots: `9router-qnap-blue` (`127.0.0.1:9321`) und `9router-qnap-green` (`127.0.0.1:9322`). Nie direkt öffentlich gebunden.
- Der stabile Ingress hält `:9311`; der bestehende HTTPS-Proxy nutzt das Bridge-Gateway auf `:9312`.
- Candidate wird gebaut, gesmokt, online gesichert, gestartet und intern health-geprüft, bevor Nginx den Upstream atomar wechselt.
- Nginx reload ist graceful; alte Worker bedienen bestehende Streams weiter. Altes App-Slot wird erst nach dem Drain gestoppt. Bei Drain-Timeout bleibt es erhalten; ein weiterer Deploy überschreibt keinen noch laufenden Slot.
- Rollback startet bei Bedarf die vorherige Version im freien Slot und schwenkt den Ingress zurück; die DB wird für normale Rollbacks nicht restauriert.
- Es laufen während kurzer Blue/Green-Überlappung beide Scheduler-Prozesse. Der Deploy minimiert dieses Fenster; Doppel-Probes bleiben ein bekanntes Restrisiko, bis Scheduler-Leases unabhängig von Web-Prozessen existieren.

## SQLite / Betriebssicherheit

- DB bleibt am vorhandenen Bind-Mount `/share/CE_CACHEDEV1_DATA/Container/9router-test/data-home:/app/data`.
- SQLite WAL + `busy_timeout=5000`; Schemaänderungen müssen additiv und Blue/Green-rückwärtskompatibel sein.
- QNAP Docker-CLI-Pfad ist `/share/CE_CACHEDEV1_DATA/.qpkg/container-station/bin/docker` (nicht im SSH-PATH).
- Script nutzt kein `docker system prune`, löscht keine alten Backups/Bilder automatisch.
- Vor Bootstrap sicherstellen, dass QNAP Platz für Green-Image, laufende DB und Nginx hat. Externes Backup-Volume hat Vorrang.
- `--legacy` führt das alte Stop-and-recreate Deployment explizit aus und verursacht Downtime.
