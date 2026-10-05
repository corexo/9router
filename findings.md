# Erkenntnisse & Entscheidungen

## Anforderungen
- JEView-Kreisdiagramm/Knoten-Map nativ in PiRouter, keine externe iframe-Anwendung.
- Eigenständige Seite für Account-Quota mit sichtbarem Reset-/Session-Countdown.
- Ergebnis: SVG-Map gruppiert Modellwahl-Kriterien aus tatsächlichen PiRouter-Logs; keine JEView-API, keine Trigger-Kanten. Account-Seite zeigt aktive quota-fähige Accounts, Reset-Countdown je Limit, OAuth-Ablauf separat.

## Forschungsergebnisse
- `/tmp/jeview-source/ui/app.js`: Originaldiagramm stellt Jev zentral, Fragen radial, Antworten als Knoten und Folgeaufrufe als Verzweigungen dar; 1 s polling, kürzlich aktive Fragen bleiben sichtbar.
- JEView `/ _/api/records`-Format umfasst `id`, `at`, `label`, `trigger`, `status`, `elapsedMs`, `questions[]` inkl. asks/options/answer/probabilities. PiRouter speichert keine JEView-Ereignis-IDs, aber eigene Jev-Traces enthalten Requests/Antworten; Map kann aus `fullPayload` und `jevResponse.rawText` die Frage/Antwort-Knoten bilden, ohne echte Trigger-Edges.
- `src/app/api/debug/jev` liefert maximal 50 in-memory Traces; `JevInspectorClient` pollt bereits 3 s.
- Bestehende Account-Quotas: `/api/providers/client?pageSize=500&sort=priority` + `/api/usage/[connectionId]`; `parseQuotaData()` normalisiert Quota-Reset-Zeiten. Safe client connections exponieren `expiresAt`.
- Quota-UI-Basis existiert in `ProviderLimits`/`QuotaTable`; reuse `Card`, `ProviderIcon` und normalisierte Utils.

## Technische Entscheidungen
| Entscheidung | Begründung |
|------|------|
| Native SVG/canvas-Karte aus vorhandenem Trace-Payload | Externes JEView ist unabhängiger Proxy; Integration soll intern laufen. Ohne `Jeview-Trigger` IDs können keine exakten causal edges nachgebaut werden. |
| Eigene `/dashboard/account-quotas`-Seite | Separate Nutzersicht, keine Verwaltungsfilter/Actions aus ProviderLimits. |
| Countdown aus `resetAt` und Connection `expiresAt` | Zeigt Quota-Fenster plus OAuth-Session-Gültigkeit getrennt. |

## Aufgetretene Probleme
| Problem | Lösung |
|------|---------|
| Frühere vereinfachte Tabelle ersetzte JEView-Kreisdiagramm | Quellcode geprüft; radiale Map nutzt vorhandene Kriterien und Jev-Auswahl. Echter trigger-Verlauf fehlt in den PiRouter-Traces. |
| `npx vitest` installierte/auflöste das Root-Alias `@/` nicht korrekt | Tests liegen in eigenständigem `tests/` Paket; `tests/node_modules/.bin/vitest --config tests/vitest.config.js` verwenden. |

## Ressourcen
- JEView source: https://github.com/andududu/jeview (`/tmp/jeview-source`, nur Referenz)
