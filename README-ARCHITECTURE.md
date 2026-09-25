# 9Router / PiRouter — Architecture & Feature Guide

> **Zentrales AI-Routing- & Infrastructure-Gateway** zur Verbindung von Coding-Tools (Claude Code, Cursor, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw etc.) mit über 40+ LLM-Providern bei maximaler Token- und Kosteneinsparung.

---

## 📑 Inhaltsverzeichnis
1. [System-Architektur & Ablauf](#1-system-architektur--ablauf)
2. [Jev AI Routing-Engine](#2-jev-ai-routing-engine)
   - [Funktionsweise & SystemOne Entscheidungen](#funktionsweise--systemone-entscheidungen)
   - [Modell-Tiers & der Modell-Klasse Slider](#modell-tiers--der-modell-klasse-slider)
   - [Ausschluss lokaler Modelle (`local-first`)](#ausschluss-lokaler-modelle-local-first)
3. [Token Saver & Komprimierungs-Engines](#3-token-saver--komprimierungs-engines)
   - [RTK Tool Trimmer](#rtk-tool-trimmer)
   - [Headroom Proxy](#headroom-proxy)
   - [Caveman Output Compressor](#caveman-output-compressor)
   - [Ponytail Senior Dev Mode](#ponytail-senior-dev-mode)
4. [Caching & Performance-Layer](#4-caching--performance-layer)
   - [Jev Decision Cache](#jev-decision-cache)
   - [Sticky Session Pinning (Prompt Cache Stabilität)](#sticky-session-pinning-prompt-cache-stabilit%C3%A4t)
   - [Headroom SmartCrusher Cache](#headroom-smartcrusher-cache)
5. [Combos & Fallback-Strategien](#5-combos--fallback-strategien)
6. [Quotas & Cockpit-Steuerung](#6-quotas--cockpit-steuerung)

---

## 1. System-Architektur & Ablauf

```
 ┌─────────────────────────────────────────────────────────────┐
 │  Entwickler-Tools / CLI Clients                             │
 │  (Claude Code, Cursor IDE, Codex, Gemini CLI, Cline, etc.)  │
 └──────────────────────────────┬──────────────────────────────┘
                                │ HTTP / SSE (Port 9310 / 20128)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  9Router / PiRouter Core                                    │
 │                                                             │
 │  1. TOKEN SAVER PIPELINE (Eingehend)                        │
 │     • RTK: Kürzt gigantische Bash-/Tool-Outputs             │
 │     • Headroom Proxy: Komprimiert Kontext via AST & SmartCrusher │
 │     • Caveman / Ponytail: Injiziert prägnante System-Prompts │
 │                                                             │
 │  2. INTELLIGENTES ROUTING                                   │
 │     • Standard-Combos (Fallback / Fusion / Round-Robin)     │
 │     • Jev AI Router: Kontext- & Tier-gesteuerte Modellauswahl│
 │                                                             │
 │  3. TRANSLATION & RESILIENZ                                 │
 │     • OpenAI ↔ Anthropic ↔ Gemini ↔ Ollama Formatwandler   │
 │     • Health Monitor (429/500 Auto-Disable & Strike-System) │
 │     • Automatisches Token-Refreshing (OAuth)                │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  AI Provider & Lokale Modelle                               │
 │  (Anthropic, OpenAI, Google, OpenCode, DeepSeek, Ollama...) │
 └─────────────────────────────────────────────────────────────┘
```

---

## 2. Jev AI Routing-Engine

Die **Jev-Engine** (`model: "jev"` oder `"nineRouter/jev"`) ist ein dynamischer Router. Anstatt Anfragen stur an ein festes Modell zu schicken, analysiert Jev jede einzelne Anfrage in Echtzeit und wählt das kostengünstigste Modell, das der Aufgabe intellektuell gewachsen ist.

### Funktionsweise & SystemOne Entscheidungen
1. **Kontext- & Token-Filter:** Jev schätzt die benötigten Kontext-Tokens ab. Modelle, deren Kontextfenster zu klein ist, werden vorab verworfen.
2. **Kandidaten-Pool:** Standardmäßig nutzt Jev die Modelle aus der eingebauten Combo `jev`.
3. **Entscheidungskriterien:** Jev erhält ein Kriterien-Profil jedes Modells (Tier, Kosten pro Million Tokens, Kontextgröße, Quota-Status, Provider-Gesundheit).
4. **Thinking-Level-Zuweisung:** Neben dem Modell entscheidet Jev dynamisch, welche Denkstufe (`minimal`, `low`, `medium`, `high`, `max`) gewählt werden soll, angepasst an die Fähigkeiten des Zielmodells.

### Modell-Tiers & der Modell-Klasse Slider
Im Cockpit (`/dashboard/cockpit`) und unter Profil-Einstellungen existiert der **Modell-Klasse-Slider**:

| Stufe | Kennung | Enthaltene Tiers | Verhalten für Jev |
| :--- | :--- | :--- | :--- |
| **1** | `fast` | Nur `fast` | Wählt nur Flash- und Mini-Modelle (z. B. `gpt-4o-mini`, `glm-flash`). Maximal sparsam. |
| **2** | `eco` | `fast`, `mid` | Sparmodus für Routineaufgaben (inkl. `haiku`, `glm-4.7`, `qwen`). Keine teuren Modelle. |
| **3** | `balanced` | Alle Tiers | **Standard:** Jev entscheidet vollkommen frei nach Komplexität des Prompts. |
| **4** | `quality` | `strong`, `frontier` | **Starke Modelle:** Schließt kleine Modelle (Haiku etc.) aus. Minimum ist Sonnet 5 / GLM-5. |
| **5** | `max` | Nur `frontier` | Nur absolute Flaggschiffe (Opus, GPT-6). Kosten spielen keine Rolle. |

### Ausschluss lokaler Modelle (`local-first`)
- Lokale Modelle (z. B. GGUF-Modelle über Ollama oder LM Studio) sind in der Combo **`local-first`** hinterlegt.
- Über den Schalter **„Lokale Modelle ('local-first') ausschließen“** im Cockpit werden diese Modelle aus Jevs Auswahl entfernt.
- **Vorteil:** Lokale Serverressourcen bleiben geschont; Jev bedient sich nur an verfügbaren Cloud-Providern.

---

## 3. Token Saver & Komprimierungs-Engines

Die Token-Saver-Sektion im Cockpit bündelt vier spezialisierte Einsparungs-Technologien:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             TOKEN SAVER MATRIX                           │
├──────────────────┬─────────────────┬───────────────────┬────────────────┤
│ Engine           │ Ansatz          │ Typische Ersparnis│ Fokus          │
├──────────────────┼─────────────────┼───────────────────┼────────────────┤
│ RTK Tool Trimmer │ Input Trimming  │ 60% – 90%         │ Tool Outputs   │
│ Headroom Proxy   │ AST/SmartCrush  │ 20% – 50%         │ Chat & History │
│ Caveman Output   │ System Prompt   │ ~65% Output       │ Antworten      │
│ Ponytail Mode    │ System Prompt   │ Code-Effizienz    │ YAGNI & Boiler │
└──────────────────┴─────────────────┴───────────────────┴────────────────┘
```

### RTK Tool Trimmer
- **Ziel:** Tool-Ergebnisse von Coding-Agenten (`git diff`, `grep`, Dateibäume, Test-Logs).
- **Methode:** Große `tool_result`-Blöcke werden intelligent zusammengefasst und auf das Wesentliche gekürzt, bevor sie das Prompt-Budget belasten.

### Headroom Proxy
- **Ziel:** Vollständige Chat-Verläufe und wiederholte Kontext-Prompts.
- **Methode:** Läuft als Companion-Dienst auf Port `8787`.
  - **SmartCrusher:** Komprimiert JSON- und Datenstrukturen ohne Informationsverlust.
  - **Code-Aware AST:** Bereinigt Code-Kontexte semantisch intakt.

### Caveman Output Compressor
- **Ziel:** Output-Token-Kosten und Generierungszeit reduzieren.
- **Stufen:** `lite`, `full`, `ultra`.
- **Methode:** Injiziert strikte Verhaltensregeln: Entfernt Höflichkeitsfloskeln, Begrüßungen und Füllprosa. Das Modell antwortet telegrafisch und liefert puren Code.

### Ponytail Senior Dev Mode
- **Ziel:** Verhindert aufgeblähten Boilerplate-Code.
- **Prinzip:** *"Lazy Senior Dev"* – Zwingt das LLM, bestehende Bibliotheken zu nutzen, Altlasten zu entfernen und nach YAGNI-Prinzipien (You Aren't Gonna Need It) minimalen, robusten Code zu schreiben.

---

## 4. Caching & Performance-Layer

### Jev Decision Cache (`decisionCache.js`)
Um redundante Anfragen an den Jev-SystemOne-Entscheider zu vermeiden:
- **Bucket-Hashing:** Tokenmengen werden in 10k-Schritten gebündelt (z. B. `42k` → `50k`).
- **Cache-Key:** Aus `Session-ID` + `Token-Bucket`.
- **TTL:** Standardmäßig 10 Minuten. Folgende Anfragen im selben Kontextfenster werden **in 0 ms** direkt aus dem RAM bedient.

### Sticky Session Pinning (`cacheSessionPin.js`)
Viele Provider (wie Anthropic oder DeepSeek) bieten **Prompt Caching** (vergünstigte Tokens für wiederverwendete System-Prompts):
- 9Router pinnt eine aktive Session an das zuerst genutzte Provider-Konto.
- Verhindert, dass Round-Robin mitten in der Session den Provider wechselt und dadurch der Prompt-Cache bricht.
- Erst bei echten Fehlern (z. B. Rate-Limit 429 oder 500) springt das Fallback-System ein.

---

## 5. Combos & Fallback-Strategien

Combos bündeln mehrere Modelle zu einem logischen Endpunkt:

- **Fallback-Strategie:** Versucht Modell A; bei Fehler oder Erschöpfung erfolgt unterbrechungsfreier Wechsel auf Modell B.
- **Fusion-Strategie:** Sendet die Anfrage parallel an ein Experten-Panel; ein konfigurierbares *Judge-Modell* fusioniert die Antworten zur besten Gesamtlösung.
- **Peak Hours Throttling:** Definiert Stoßzeiten (z. B. Mo–Fr 14–19 Uhr), in denen teure Modelle (Claude Opus/Sonnet) prozentual gedrosselt und auf alternative Modelle umgeleitet werden.

---

## 6. Quotas & Cockpit-Steuerung

- **Live Token Flow:** Echtzeit-Monitoring über Server-Sent Events (`/api/usage/stream`) mit Tokens In/Out pro Sekunde.
- **Kompakter Quota Tracker:** Zeigt den Stand von Wochen- und 5-Stunden-Limits aller Provider an.
- **Per-Account Force Refresh:** Über den Refresh-Button (`↻`) neben jedem Account können Limits mit `?force=1` direkt live beim jeweiligen Anbieter abgefragt werden.

---

## 🚀 Schnellstart

```bash
# Repository klonen & Abhängigkeiten installieren
git clone https://github.com/corexo/9router.git
cd 9router
npm install

# Entwicklungsserver starten
npm run dev

# Produktions-Build & Docker-Start
npm run build
docker compose up -d
```

Standardmäßig erreichbar unter: `http://localhost:9310` (oder Port `20128`).
