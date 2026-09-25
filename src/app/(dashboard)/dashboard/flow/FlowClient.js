"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";
import { buildPath, pathColor } from "./path.js";

// --- Mesh-Definition: 9Router Request-Tunnel (feste Phasen) ---
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

const DOT_COLOR = {
  input: "bg-cyan-500",
  process: "bg-indigo-500",
  storage: "bg-amber-500",
  ok: "bg-emerald-500",
  e: "bg-rose-500",
};

const EDGE_COLOR = {
  bad: "stroke-rose-500",
  good: "stroke-emerald-500",
  amber: "stroke-amber-500",
  hot: "stroke-sky-500",
};

function geo(e) {
  const a = nodeById(e.from), b = nodeById(e.to);
  if (a.x === b.x) {
    const x = a.x + 95;
    return { d: `M${x},${a.y + 34} L${x},${b.y}`, mx: x, my: (a.y + 34 + b.y) / 2 };
  }
  const sy = a.y + 17, ey = b.y + 17, sx = a.x + 190, ex = b.x;
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
    setSelIdx("");
    setRefreshing(true);
    try {
      const res = await fetch("/api/usage/request-details?pageSize=50");
      const json = await res.json();
      setReqs((json.details || []).map((d, i) => ({
        i,
        time: (d.timestamp || "").replace("T", " ").slice(5, 19),
        model: d.model || d.request?.model || "?",
        provider: d.provider || "?",
        status: d.status || "success",
        total: d.latency?.total ?? 0,
        ttft: d.latency?.ttft ?? 0,
        tokIn: d.tokens?.prompt_tokens ?? 0,
        tokOut: d.tokens?.completion_tokens ?? 0,
        cached: !!(d.tokens && (d.tokens.cached_tokens || d.tokens.cache_read_input_tokens || d.tokens.prompt_tokens_details?.cached_tokens)),
        stream: !!(d.request && d.request.stream),
        code: d.response?.status,
        err: d.response?.error,
      })));
      setErr(null);
    } catch (e) { setErr(e.message); }
    setRefreshing(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const sel = selIdx !== "" && reqs[selIdx] ? reqs[selIdx] : null;
  const path = useMemo(() => (sel ? buildPath(sel) : []), [sel]);
  const hotKeys = useMemo(() => {
    const s = new Set();
    for (let i = 0; i < path.length - 1; i++) s.add(`${path[i]}>${path[i+1]}`);
    return s;
  }, [path]);
  const inPath = useMemo(() => new Set(path), [path]);

  useEffect(() => {
    if (!path.length) return;
    let stop = false;
    (async () => {
      for (let i = 0; i < path.length - 1 && !stop; i++) {
        await fly(`${path[i]}>${path[i+1]}`, pathColor(sel));
      }
    })();
    return () => { stop = true; };
  }, [path, sel]);

  const noReqs = loaded && !err && reqs.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main tracking-tight">Request Flow</h1>
          <p className="text-sm text-text-muted mt-1">
            Pfad-Analyse echter Requests durch den 9Router-Tunnel: Cache, Stream, Fallback, Fehler
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selIdx}
            onChange={(e) => setSelIdx(e.target.value)}
            disabled={noReqs}
            className="max-w-[420px] rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-brand-500"
          >
            <option value="" disabled>{noReqs ? "Keine Requests in DB" : "Request wählen…"}</option>
            {reqs.map((r) => (
              <option key={r.i} value={r.i}>
                {r.time} · {r.model} · {r.provider} · {r.status === "error" ? `FEHLER${r.code ? " " + r.code : ""}` : "OK"} · {r.total}ms{r.cached ? " · CACHE" : ""}{r.stream ? " · STREAM" : ""}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={refreshing} className="flex items-center gap-1.5">
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

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-auto p-6 bg-[#0a0f1c]">
          <div className="relative w-[1140px] h-[640px] mx-auto rounded-xl"
            style={{ backgroundImage: "radial-gradient(#6366f122 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
            <div className="absolute -top-1 left-0 text-[10px] font-bold tracking-widest text-cyan-400">INGESTION</div>
            <div className="absolute -top-1 left-[290px] text-[10px] font-bold tracking-widest text-indigo-400">GATEWAY &amp; CORE</div>
            <div className="absolute -top-1 left-[940px] text-[10px] font-bold tracking-widest text-emerald-400">OUTPUT</div>

            <svg className="absolute inset-0 w-full h-full pointer-events-none z-[1]">
              <defs>
                <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 0L10 5 0 10z" fill="#475569" />
                </marker>
              </defs>
              <g>
                {E.map((e) => {
                  const { d } = geo(e);
                  const hot = hotKeys.has(key(e));
                  return (
                    <path key={key(e)} id={`fe-${key(e)}`} d={d} fill="none" markerEnd="url(#flow-arrow)"
                      strokeWidth={hot ? 2.6 : 1.5} stroke="currentColor"
                      className={hot ? EDGE_COLOR[e.status || "hot"] : "stroke-slate-700"}
                      style={{ opacity: hot ? 1 : hotKeys.size ? 0.08 : 0.45, filter: hot ? "drop-shadow(0 0 5px currentColor)" : "none", transition: "all .25s" }} />
                  );
                })}
              </g>
              <g>
                {E.map((e) => {
                  const { mx, my } = geo(e);
                  const hot = hotKeys.has(key(e));
                  return (
                    <text key={key(e)} x={mx} y={my + 3} textAnchor="middle" fontSize="9"
                      className="fill-slate-400"
                      style={{ opacity: hotKeys.size ? (hot ? 0.95 : 0.1) : 0.75 }}>
                      {e.label}
                    </text>
                  );
                })}
              </g>
              <g id="flow-particles" />
            </svg>

            {N.map((n) => {
              const dim = inPath.size > 0 && !inPath.has(n.id);
              return (
                <div key={n.id} onClick={() => setCard(n.id)}
                  className={`absolute z-[2] flex items-center gap-2 px-3 rounded-full cursor-pointer border hover:border-indigo-400 transition-all ${dim ? "opacity-15 grayscale" : ""}`}
                  style={{ left: n.x, top: n.y, width: 190, height: 34, background: "#131e33", borderColor: inPath.has(n.id) ? "#38bdf8" : "#26334b", boxShadow: inPath.has(n.id) ? "0 0 0 2px #38bdf866, 0 0 14px #38bdf855" : "none" }}>
                  <span className={`w-2 h-2 rounded-full flex-none ${DOT_COLOR[n.group]}`} />
                  <span className="text-[11px] font-semibold text-slate-200 truncate">{n.name}</span>
                </div>
              );
            })}

            {card && (() => {
              const n = nodeById(card);
              const ins = E.filter((e) => e.to === n.id);
              const outs = E.filter((e) => e.from === n.id);
              return (
                <div className="absolute z-[5] w-[250px] rounded-xl border border-slate-600 bg-[#0e1626] p-3 shadow-2xl"
                  style={{ left: Math.min(n.x + 200, 880), top: Math.max(n.y - 20, 0) }}>
                  <button className="absolute top-2 right-2 text-slate-500 hover:text-white" onClick={() => setCard(null)}>✕</button>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${DOT_COLOR[n.group]}`} />
                    <h3 className="text-sm font-bold text-white">{n.name}</h3>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-2">{n.desc}</p>
                  <div className="text-[9px] text-slate-500 mt-2 mb-1 tracking-widest">EINGANG</div>
                  {ins.map((e) => (
                    <div key={key(e)} className="text-[10px] bg-[#080c14] border border-slate-800 rounded px-1.5 py-1 my-0.5 text-indigo-300">
                      ← {nodeById(e.from).name} <span className="text-slate-500">{e.label}</span>
                    </div>
                  ))}
                  {!ins.length && <div className="text-[10px] text-slate-600">—</div>}
                  <div className="text-[9px] text-slate-500 mt-2 mb-1 tracking-widest">AUSGANG</div>
                  {outs.map((e) => (
                    <div key={key(e)} className="text-[10px] bg-[#080c14] border border-slate-800 rounded px-1.5 py-1 my-0.5 text-emerald-300">
                      → {nodeById(e.to).name} <span className="text-slate-500">{e.label}</span>
                    </div>
                  ))}
                  {!outs.length && <div className="text-[10px] text-slate-600">—</div>}
                </div>
              );
            })()}
          </div>
        </div>
      </Card>

      <Card padding="sm">
        {sel ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <Badge variant={sel.status === "error" ? "error" : "success"} size="sm">
              {sel.status === "error" ? `FEHLER${sel.code ? " " + sel.code : ""}` : "OK"}
            </Badge>
            <span className="font-mono text-text-main">{sel.model}</span>
            <span className="text-text-muted">via {sel.provider}</span>
            <span className="font-semibold text-cyan-500">{sel.total} ms</span>
            {sel.ttft ? <span>TTFT {sel.ttft} ms</span> : null}
            <span>IN {sel.tokIn}</span>
            <span>OUT {sel.tokOut}</span>
            {sel.cached && <Badge variant="outline" size="sm" className="font-mono">CACHE</Badge>}
            {sel.stream && <Badge variant="outline" size="sm" className="font-mono">STREAM</Badge>}
            {sel.err && <span className="text-rose-500 dark:text-rose-400 truncate max-w-[300px]">{sel.err}</span>}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Request wählen oder Knoten anklicken — der Pfad wird aus echten Request-Details (SQLite) abgeleitet.
          </p>
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
      else { c.remove(); resolve(); }
    })(start);
  });
}
