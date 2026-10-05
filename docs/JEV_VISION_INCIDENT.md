# JEV-Bildanfragen: leerer Modellpool und HTTP 500

**Stand:** 2026-09-27 · **Fix:** `298f6385` (Worktree), `381f314a` (Produktions-Checkout)

## Symptom

Bildanfragen an `jev` scheiterten mit `500 status code (no body)`. Der Router meldete `Vision-Filter: 0/0 Modelle können Bilder verarbeiten`; danach wurde ein nicht vorhandenes Fallback-Modell verwendet (`TypeError: Cannot read properties of undefined (reading 'includes')`). Textanfragen waren nicht betroffen.

## Ursache

`estimateQoderPromptTokens()` in `open-sse/shared/qoder/contextTier.js` zählte den gesamten Base64-String einer `data:image/...;base64,...`-URL als Text. Das überschätzte die Kontextgröße und entfernte alle Kandidaten bereits vor dem Vision-Filter. `0/0` bedeutete **keine verbleibenden Kandidaten**, nicht fehlende Vision-Fähigkeit der registrierten Modelle.

## Änderung und Prüfung

Der Token-Schätzer ersetzt Base64-Bilddaten beim Zählen durch `[image]` und addiert pro Bild pauschal 2000 Tokens. Andere Inhalte bleiben unverändert. Ein ausführbarer Assert prüfte: Eine 500-KB-Base64-URL ergibt ungefähr 2029 statt über 125000 geschätzte Tokens. `docker build -t corexo/9router:local .` war erfolgreich; der Container `9router` wurde neu erstellt. Danach zeigte ein Live-Log `Vision-Filter: 5/5 Modelle können Bilder verarbeiten`.

**Grenze:** Die 2000 Tokens sind eine Schätzung, keine genaue Abrechnung des Upstream-Bildmodells. Der Live-Log belegt den behobenen Kandidatenfilter, nicht eine erfolgreich abgeschlossene Bildantwort. Bei erneutem Fehler zuerst HTTP-Status und Upstream-Fehler der konkreten Bildanfrage prüfen.
