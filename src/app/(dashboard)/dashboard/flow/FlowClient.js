"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";
import { buildPath, pathColor } from "./path.js";

// --- Mesh-Definition: PiRouter Request-Tunnel (feste Phasen) ---
const N = [
  ["http", "HTTP REST", "input", 0, 40, "Eingehende OpenAI-kompatible Anfrage (CLI, IDE, Web)."],
  ["webhook", "Webhook", "input", 0, 150, "Eingehende POST-Events von Drittanbietern."],
  ["cron", "Cron / Scheduler", "input", 0, 260, "Zeitgesteuerte Jobs."],
  ["gateway", "API Gateway", "process", 290, 115, "Routing, IP-Filter, Token-Bucket Rate-Limit."],
  ["auth", "Auth / API-Key", "process", 290, 235, "Endpoint-Key-, Scope- und Connection-Check."],
  ["cache", "Prompt Cache", "storage", 590, 30, "Cached Tokens aus Provider-Prompt-Cache (HIT/MISS)."],
  ["engine", "Routing Engine", "process", 590, 160, "Model-Auflösung, Provider-Routing, Fallback, RTK."],
  ["db", "SQLite Store", "storage", 590, 290, "Usage- und Request-Details-Persistenz."],
  ["queue", "Queue", "storage", 590, 410, "Asynchrone Entkopplung von Jobs."],
  ["ai", "Provider / LLM", "process", 590, 520, "Der finale LLM-Provider-Aufruf (Inferenz, Stream)."],
  ["ok", "HTTP 200 / 201", "ok", 940, 50, "Erfolgreiche JSON-Antwort zurück zum Client."],
  ["stream", "SSE Stream", "ok", 940, 180, "Live-Token-Streaming zurück zum Client."],
  ["ack", "ACK 202", "ok", 940, 310, "Async-Job angenommen."],
  ["error", "Error 4xx / 5xx", "e", 940, 450, "Fehlerantwort (Auth, Provider, Timeout)."],
].map(([id, name, group, x, y, desc]) => ({ id, name, group, x, y, desc }));

const E = [
  ["http", "gateway", "REST Call"],
  ["webhook", "gateway", "Inbound POST"],
  ["cron", "queue", "Scheduled Job"],
  ["gateway", "auth", "Rate-Limit OK"],
  ["auth", "cache", "Cache prüfen"],
  ["auth", "engine", "Key gültig"],
  ["auth", "error", "Unauthorized 401", "bad"],
  ["cache", "ok", "Cache HIT", "good"],
  ["cache", "engine", "Cache MISS"],
  ["engine", "db", "Usage Write"],
  ["engine", "queue", "Enqueue Job"],
  ["engine", "ai", "Provider Call"],
  ["engine", "ok", "Direct Response", "good"],
  ["db", "ok", "Commit OK", "good"],
  ["queue", "ack", "Job ACK", "good"],
  ["ai", "stream", "Token Stream", "amber"],
].map(([from, to, label, status]) => ({ from, to, label, status }));

const key = (e) => `${e.from}>${e.to}`;
const nodeById = (id) => N.find((n) => n.id === id);

const DOT_COLOR_HEX = {
  input: "#06b6d4",
  process: "#6366f1",
  storage: "#f59e0b",
  ok: "#10b981",
  e: "#f43f5e",
};

const EDGE_COLOR = {
  bad: "stroke-rose-500",
  good: "stroke-emerald-500",
  amber: "stroke-amber-500",
  hot: "stroke-sky-400",
};

function geo(e) {
  const a = nodeById(e.from);
  const b = nodeById(e.to);
  if (!a || !b) return { d: "", mx: 0, my: 0 };

  if (a.x === b.x) {
    const x = a.x + 95;
    return { d: `M${x},${a.y + 34} L${x},${b.y}`, mx: x, my: (a.y + 34 + b.y) / 2 };
  }
  const sy = a.y + 17;
  const ey = b.y + 17;
  const sx = a.x + 190;
  const ex = b.x;
  const t = Math.max(Math.abs(ex - sx) * 0.45, 40);
  return { d: `M${sx},${sy} C${sx + t},${sy} ${ex - t},${ey} ${ex},${ey}`, mx: (sx + ex) / 2, my: (sy + ey) / 2 };
}

export default function FlowClient() {
  const [reqs, setReqs] = useState([]);
  const [selIdx, setSelIdx] = useState("");
  const [card, setCard] = useState(null);
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/usage/request-details?pageSize=50");
      const json = await res.json();
      const list = (json.details || []).map((d, i) => ({
        i,
        time: (d.timestamp || "").replace("T", " ").slice(5, 19),
        model: d.model || d.request?.model || "?",
        provider: d.provider || "?",
        status: d.status || "success",
        total: d.latency?.total ?? 0,
        ttft: d.latency?.ttft ?? 0,
        tokIn: d.tokens?.prompt_tokens ?? 0,
        tokOut: d.tokens?.completion_tokens ?? 0,
        cached: !!(
          d.tokens &&
          (d.tokens.cached_tokens || d.tokens.cache_read_input_tokens || d.tokens.prompt_tokens_details?.cached_tokens)
        ),
        stream: !!(d.request && d.request.stream),
        code: d.response?.status,
        err: d.response?.error,
      }));
      setReqs(list);
      if (list.length > 0 && selIdx === "") {
        setSelIdx("0"); // Auto-select most recent
      }
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
    setRefreshing(false);
    setLoaded(true);
  }, [selIdx]);

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const sel = selIdx !== "" && reqs[selIdx] ? reqs[selIdx] : null;
  const path = useMemo(() => (sel ? buildPath(sel) : []), [sel]);
  const hotKeys = useMemo(() => {
    const s = new Set();
    for (let i = 0; i < path.length - 1; i++) s.add(`${path[i]}>${path[i + 1]}`);
    return s;
  }, [path]);
  const inPath = useMemo(() => new Set(path), [path]);

  useEffect(() => {
    if (!path.length) return;
    let stop = false;
    (async () => {
      for (let i = 0; i < path.length - 1 && !stop; i++) {
        await fly(`${path[i]}>${path[i + 1]}`, pathColor(sel));
      }
    })();
    return () => {
      stop = true;
    };
  }, [path, sel]);

  const noReqs = loaded && !err && reqs.length === 0;

  const currentIdxNum = selIdx !== "" ? Number(selIdx) : -1;
  const hasPrev = currentIdxNum > 0;
  const hasNext = currentIdxNum >= 0 && currentIdxNum < reqs.length - 1;

  const activeNode = card ? nodeById(card) : null;
  const nodeInputs = activeNode ? E.filter((e) => e.to === activeNode.id) : [];
  const nodeOutputs = activeNode ? E.filter((e) => e.from === activeNode.id) : [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-main tracking-tight">Request Flow</h1>
            <Badge variant="outline" size="sm" className="font-mono text-cyan-600 dark:text-cyan-400 border-cyan-500/30">
              LIVE MESH
            </Badge>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Pfad-Analyse echter Requests durch das PiRouter-Netzwerk: Cache, Ingestion, Gateway, Engine &amp; Stream.
          </p>
        </div>

        {/* Request Navigation & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Step Prev/Next */}
          <div className="flex items-center bg-surface-2 rounded-lg border border-border">
            <button
              onClick={() => setSelIdx(String(currentIdxNum - 1))}
              disabled={!hasPrev}
              title="Vorheriger (neuerer) Request"
              className="p-2 text-text-muted hover:text-text-main disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <button
              onClick={() => setSelIdx(String(currentIdxNum + 1))}
              disabled={!hasNext}
              title="Nächster (älterer) Request"
              className="p-2 text-text-muted hover:text-text-main disabled:opacity-30 disabled:cursor-not-allowed border-l border-border"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>

          <select
            value={selIdx}
            onChange={(e) => setSelIdx(e.target.value)}
            disabled={noReqs}
            className="w-full sm:w-auto max-w-[380px] rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-mono text-text-main focus:outline-none focus:border-brand-500 truncate"
          >
            <option value="" disabled>
              {noReqs ? "Keine Requests in DB" : "Request wählen…"}
            </option>
            {reqs.map((r) => (
              <option key={r.i} value={r.i}>
                {r.time} · {r.model} · {r.provider} · {r.status === "error" ? `ERR${r.code ? " " + r.code : ""}` : "OK"} · {r.total}ms{r.cached ? " · CACHE" : ""}{r.stream ? " · STREAM" : ""}
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <span className={`material-symbols-outlined text-[16px] ${refreshing ? "animate-spin" : ""}`}>refresh</span>
            <span>Aktualisieren</span>
          </Button>
        </div>
      </div>

      {err && (
        <Card padding="sm" className="border-rose-500/40">
          <div className="text-sm text-rose-500 dark:text-rose-400">Fehler beim Laden der Requests: {err}</div>
        </Card>
      )}

      {/* Selected Request Overview Banner & Pipeline Stepper */}
      {sel && (
        <Card padding="md" className="bg-surface-2/40 border-border">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={sel.status === "error" ? "error" : "success"} size="sm">
                  {sel.status === "error" ? `FEHLER ${sel.code || ""}` : "SUCCESS 200"}
                </Badge>
                <span className="font-mono font-semibold text-text-main text-sm">{sel.model}</span>
                <span className="text-xs text-text-muted">via</span>
                <span className="px-2 py-0.5 rounded text-xs font-mono bg-surface-3 text-text-main border border-border">
                  {sel.provider}
                </span>
                <span className="font-mono font-semibold text-cyan-600 dark:text-cyan-400 text-xs sm:text-sm">
                  {sel.total} ms
                </span>
                {sel.ttft ? (
                  <span className="text-xs text-text-muted font-mono">TTFT: {sel.ttft}ms</span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-muted">
                  Tokens: <strong className="text-text-main">{sel.tokIn}</strong> In /{" "}
                  <strong className="text-text-main">{sel.tokOut}</strong> Out
                </span>
                {sel.cached && (
                  <Badge variant="outline" size="sm" className="font-mono text-emerald-600 border-emerald-500/30">
                    CACHE HIT
                  </Badge>
                )}
                {sel.stream && (
                  <Badge variant="outline" size="sm" className="font-mono text-amber-600 border-amber-500/30">
                    STREAM
                  </Badge>
                )}
              </div>
            </div>

            {/* Stepper Pipeline */}
            {path.length > 0 && (
              <div className="pt-2 border-t border-border flex items-center gap-1 sm:gap-2 overflow-x-auto py-1">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex-none mr-1">
                  Pfad:
                </span>
                {path.map((nodeId, idx) => {
                  const n = nodeById(nodeId);
                  return (
                    <div key={nodeId} className="flex items-center gap-1 sm:gap-2 flex-none">
                      <button
                        onClick={() => setCard(card === nodeId ? null : nodeId)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          card === nodeId
                            ? "bg-brand-500 text-white border-brand-500 shadow-sm"
                            : "bg-surface-2 hover:bg-surface-3 text-text-main border-border"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full`} style={{ backgroundColor: DOT_COLOR_HEX[n?.group || "process"] }} />
                        <span>{n?.name || nodeId}</span>
                      </button>
                      {idx < path.length - 1 && (
                        <span className="material-symbols-outlined text-[14px] text-text-muted flex-none">
                          arrow_forward
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Main Flow Diagram (Responsive SVG ViewBox) */}
      <Card padding="none" className="overflow-hidden bg-surface-1 border-border shadow-sm">
        {/* Stage Columns Label Header */}
        <div className="grid grid-cols-4 px-6 py-2.5 border-b border-border bg-surface-2/60 text-[11px] font-semibold tracking-wider uppercase text-text-muted">
          <div className="text-cyan-600 dark:text-cyan-400">1. Ingestion</div>
          <div className="text-indigo-600 dark:text-indigo-400">2. Gateway &amp; Auth</div>
          <div className="text-amber-600 dark:text-amber-400">3. Engine &amp; Storage</div>
          <div className="text-emerald-600 dark:text-emerald-400 text-right">4. Output</div>
        </div>

        {/* Responsive Diagram Container */}
        <div className="w-full relative p-2 sm:p-4 bg-surface-1 dark:bg-[#070c18] overflow-hidden">
          <div
            className="w-full relative"
            style={{
              backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              color: "rgba(99, 102, 241, 0.08)",
            }}
          >
            <svg
              viewBox="0 0 1140 590"
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-auto block select-none"
            >
              <defs>
                <marker
                  id="flow-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M0 0L10 5 0 10z" fill="#64748b" />
                </marker>
                <marker
                  id="flow-arrow-hot"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M0 0L10 5 0 10z" fill="#38bdf8" />
                </marker>
              </defs>

              {/* Edge Connecting Curves */}
              <g>
                {E.map((e) => {
                  const { d } = geo(e);
                  const isHot = hotKeys.has(key(e));
                  return (
                    <path
                      key={key(e)}
                      id={`fe-${key(e)}`}
                      d={d}
                      fill="none"
                      markerEnd={isHot ? "url(#flow-arrow-hot)" : "url(#flow-arrow)"}
                      strokeWidth={isHot ? 2.8 : 1.4}
                      stroke="currentColor"
                      className={
                        isHot
                          ? EDGE_COLOR[e.status || "hot"]
                          : "stroke-slate-300 dark:stroke-slate-800"
                      }
                      style={{
                        opacity: isHot ? 1 : hotKeys.size ? 0.12 : 0.45,
                        filter: isHot ? "drop-shadow(0 0 6px currentColor)" : "none",
                        transition: "all .3s ease",
                      }}
                    />
                  );
                })}
              </g>

              {/* Edge Text Labels */}
              <g>
                {E.map((e) => {
                  const { mx, my } = geo(e);
                  const isHot = hotKeys.has(key(e));
                  return (
                    <text
                      key={key(e)}
                      x={mx}
                      y={my + 3}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontFamily="monospace"
                      className={
                        isHot
                          ? "fill-text-main dark:fill-white font-semibold"
                          : "fill-slate-400 dark:fill-slate-500"
                      }
                      style={{
                        opacity: hotKeys.size ? (isHot ? 1 : 0.15) : 0.75,
                        transition: "opacity .3s ease",
                      }}
                    >
                      {e.label}
                    </text>
                  );
                })}
              </g>

              {/* Animated Particles Container */}
              <g id="flow-particles" />

              {/* Nodes Vector Elements */}
              {N.map((n) => {
                const isSelected = card === n.id;
                const isHot = inPath.has(n.id);
                const isDimmed = inPath.size > 0 && !isHot;

                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    onClick={() => setCard(isSelected ? null : n.id)}
                    className="cursor-pointer group"
                    style={{
                      opacity: isDimmed ? 0.2 : 1,
                      transition: "opacity .3s ease, filter .3s ease",
                    }}
                  >
                    {/* Node Capsule */}
                    <rect
                      width="190"
                      height="34"
                      rx="17"
                      className={`transition-all duration-200 ${
                        isSelected
                          ? "fill-indigo-500/20 dark:fill-[#1e293b] stroke-brand-500 stroke-2"
                          : isHot
                          ? "fill-surface-2 dark:fill-[#131e33] stroke-sky-400 stroke-2"
                          : "fill-surface-2 dark:fill-[#0f172a] stroke-border dark:stroke-slate-700/80 group-hover:stroke-indigo-400"
                      }`}
                      style={{
                        filter: isSelected
                          ? "drop-shadow(0 0 10px rgba(99, 102, 241, 0.5))"
                          : isHot
                          ? "drop-shadow(0 0 8px rgba(56, 189, 248, 0.4))"
                          : "none",
                      }}
                    />

                    {/* Category Dot */}
                    <circle cx="16" cy="17" r="4.5" fill={DOT_COLOR_HEX[n.group]} />

                    {/* Node Text Label */}
                    <text
                      x="28"
                      y="21"
                      fontSize="11"
                      fontWeight="600"
                      className="fill-text-main dark:fill-slate-200 font-sans"
                    >
                      {n.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Selected Node Inspector Drawer (Embedded & Responsive) */}
        {activeNode && (
          <div className="p-4 sm:p-5 border-t border-border bg-surface-2/60 animate-in fade-in duration-200">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-3 h-3 rounded-full flex-none"
                  style={{ backgroundColor: DOT_COLOR_HEX[activeNode.group] }}
                />
                <h3 className="text-base font-bold text-text-main">{activeNode.name}</h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-surface-3 text-text-muted">
                  {activeNode.group}
                </span>
              </div>
              <button
                onClick={() => setCard(null)}
                className="text-text-muted hover:text-text-main p-1 rounded hover:bg-surface-3 transition-colors"
                title="Inspektor schließen"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <p className="mt-2 text-xs sm:text-sm text-text-muted leading-relaxed">
              {activeNode.desc}
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-border">
              {/* Inbound */}
              <div>
                <span className="text-[10px] font-bold text-text-muted tracking-wider uppercase">
                  Eingehende Verbindungen ({nodeInputs.length})
                </span>
                <div className="mt-1.5 flex flex-col gap-1">
                  {nodeInputs.length > 0 ? (
                    nodeInputs.map((e) => (
                      <div
                        key={key(e)}
                        onClick={() => setCard(e.from)}
                        className="cursor-pointer text-xs bg-surface-2 hover:bg-surface-3 border border-border rounded-md px-2.5 py-1.5 flex items-center justify-between text-indigo-600 dark:text-indigo-400 transition-colors"
                      >
                        <span className="font-semibold">← {nodeById(e.from)?.name}</span>
                        <span className="text-[11px] font-mono text-text-muted">{e.label}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-text-muted italic">Keine (Startknoten)</span>
                  )}
                </div>
              </div>

              {/* Outbound */}
              <div>
                <span className="text-[10px] font-bold text-text-muted tracking-wider uppercase">
                  Ausgehende Verbindungen ({nodeOutputs.length})
                </span>
                <div className="mt-1.5 flex flex-col gap-1">
                  {nodeOutputs.length > 0 ? (
                    nodeOutputs.map((e) => (
                      <div
                        key={key(e)}
                        onClick={() => setCard(e.to)}
                        className="cursor-pointer text-xs bg-surface-2 hover:bg-surface-3 border border-border rounded-md px-2.5 py-1.5 flex items-center justify-between text-emerald-600 dark:text-emerald-400 transition-colors"
                      >
                        <span className="font-semibold">→ {nodeById(e.to)?.name}</span>
                        <span className="text-[11px] font-mono text-text-muted">{e.label}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-text-muted italic">Keine (Endknoten)</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function fly(edgeKey, color) {
  return new Promise((resolve) => {
    const pathEl = document.getElementById(`fe-${edgeKey}`);
    if (!pathEl) return resolve();
    const g = document.getElementById("flow-particles");
    if (!g) return resolve();
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("r", "5");
    c.setAttribute("fill", color);
    c.style.filter = `drop-shadow(0 0 6px ${color})`;
    g.appendChild(c);
    const len = pathEl.getTotalLength();
    const start = performance.now();
    (function step(t) {
      const q = Math.min((t - start) / 420, 1);
      const pt = pathEl.getPointAtLength(q * len);
      c.setAttribute("cx", pt.x);
      c.setAttribute("cy", pt.y);
      if (q < 1) requestAnimationFrame(step);
      else {
        c.remove();
        resolve();
      }
    })(start);
  });
}
