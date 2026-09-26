"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";
import { usePersistentState } from "@/shared/hooks";
import { buildPath, pathColor } from "./path.js";

// --- Node definitions with iconography and streamlined descriptions ---
const N = [
  ["http", "HTTP REST", "input", 0, 40, "OpenAI-kompatible Schnittstelle"],
  ["webhook", "Webhook", "input", 0, 155, "Asynchrone Ingestion Events"],
  ["cron", "Scheduler", "input", 0, 270, "Zeitgesteuerte Jobs & Warmup"],
  ["gateway", "API Gateway", "process", 290, 115, "Rate-Limiting & IP-Filter"],
  ["auth", "Auth & Keys", "process", 290, 240, "Key-Check & Permissions"],
  ["cache", "Prompt Cache", "storage", 590, 25, "Prefix-Cache & KV-Lookup"],
  ["engine", "Routing Engine", "process", 590, 150, "Modellwahl, Jev & Fallbacks"],
  ["db", "SQLite Store", "storage", 590, 275, "Usage- & Request-Logs"],
  ["queue", "Queue", "storage", 590, 400, "Job-Puffer & Entkopplung"],
  ["ai", "Provider / LLM", "process", 590, 520, "Claude, GLM, OpenAI Inferenz"],
  ["ok", "HTTP 200 OK", "ok", 940, 50, "Erfolgreiche JSON-Antwort"],
  ["stream", "SSE Stream", "ok", 940, 185, "Live-Token-Streaming"],
  ["ack", "ACK 202", "ok", 940, 320, "Asynchrone Bestätigung"],
  ["error", "Error 4xx/5xx", "e", 940, 455, "Fehler- oder Timeout-Response"],
].map(([id, name, group, x, y, desc]) => ({ id, name, group, x, y, desc }));

const NODE_ICONS = {
  http: "terminal",
  webhook: "webhook",
  cron: "schedule",
  gateway: "shield",
  auth: "vpn_key",
  cache: "bolt",
  engine: "hub",
  db: "database",
  queue: "swap_calls",
  ai: "smart_toy",
  ok: "check_circle",
  stream: "waves",
  ack: "done_all",
  error: "error",
};

const E = [
  ["http", "gateway", "REST Call"],
  ["webhook", "gateway", "Inbound POST"],
  ["cron", "queue", "Scheduled Job"],
  ["gateway", "auth", "Rate-Limit OK"],
  ["auth", "cache", "Cache Check"],
  ["auth", "engine", "Key Valid"],
  ["auth", "error", "Unauthorized", "bad"],
  ["cache", "ok", "Cache HIT", "good"],
  ["cache", "engine", "Cache MISS"],
  ["engine", "db", "Usage Write"],
  ["engine", "queue", "Enqueue Job"],
  ["engine", "ai", "Provider Call"],
  ["engine", "ok", "Direct Response", "good"],
  ["engine", "error", "Route Error", "bad"],
  ["db", "ok", "Commit OK", "good"],
  ["queue", "ack", "Job ACK", "good"],
  ["ai", "stream", "Token Stream", "amber"],
  ["ai", "ok", "Response Complete", "good"],
  ["ai", "error", "Provider Error", "bad"],
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
  good: "stroke-emerald-400",
  amber: "stroke-amber-400",
  hot: "stroke-sky-400",
};

function geo(e) {
  const a = nodeById(e.from);
  const b = nodeById(e.to);
  if (!a || !b) return { d: "", mx: 0, my: 0 };

  if (a.x === b.x) {
    const x = a.x + 95;
    return { d: `M${x},${a.y + 38} L${x},${b.y}`, mx: x, my: (a.y + 38 + b.y) / 2 };
  }
  const sy = a.y + 19;
  const ey = b.y + 19;
  const sx = a.x + 190;
  const ex = b.x;
  const t = Math.max(Math.abs(ex - sx) * 0.45, 40);
  return { d: `M${sx},${sy} C${sx + t},${sy} ${ex - t},${ey} ${ex},${ey}`, mx: (sx + ex) / 2, my: (sy + ey) / 2 };
}

export default function FlowClient() {
  const [reqs, setReqs] = useState([]);
  const [selIdx, setSelIdx] = useState(0);
  const [card, setCard] = useState(null);
  const [filter, setFilter] = usePersistentState("9router_flow_filter", "all"); // "all" | "cache" | "stream" | "error"
  const [layoutMode, setLayoutMode] = usePersistentState("9router_flow_layout_mode", "split"); // "split" | "stacked"
  const [isLiveLoop, setIsLiveLoop] = usePersistentState("9router_flow_live_loop", false);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/usage/request-details?pageSize=50");
      const json = await res.json();
      const list = (json.details || []).map((d, i) => ({
        i,
        time: (d.timestamp || "").replace("T", " ").slice(5, 19),
        rawTime: d.timestamp,
        model: d.model || d.request?.model || "unknown",
        provider: d.provider || "default",
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
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Filtered requests
  const filteredReqs = useMemo(() => {
    if (filter === "cache") return reqs.filter((r) => r.cached);
    if (filter === "stream") return reqs.filter((r) => r.stream);
    if (filter === "error") return reqs.filter((r) => r.status === "error" || (r.code && r.code >= 400));
    return reqs;
  }, [reqs, filter]);

  // Active selected request
  const sel = filteredReqs[selIdx] || filteredReqs[0] || null;
  const path = useMemo(() => (sel ? buildPath(sel) : []), [sel]);
  const hotKeys = useMemo(() => {
    const s = new Set();
    for (let i = 0; i < path.length - 1; i++) s.add(`${path[i]}>${path[i + 1]}`);
    return s;
  }, [path]);
  const inPath = useMemo(() => new Set(path), [path]);

  // Run photon particle flight along the path
  const playFlowAnimation = useCallback(async () => {
    if (!path.length || isPlaying) return;
    setIsPlaying(true);
    for (let i = 0; i < path.length - 1; i++) {
      await fly(`${path[i]}>${path[i + 1]}`, pathColor(sel));
    }
    setIsPlaying(false);
  }, [path, sel, isPlaying]);

  useEffect(() => {
    playFlowAnimation();
  }, [sel?.i]);

  // Live Auto-Advance loop
  useEffect(() => {
    if (!isLiveLoop || filteredReqs.length === 0) return;
    const timer = setInterval(() => {
      setSelIdx((prev) => (prev + 1) % filteredReqs.length);
    }, 3800);
    return () => clearInterval(timer);
  }, [isLiveLoop, filteredReqs.length]);

  const activeNode = card ? nodeById(card) : null;
  const nodeInputs = activeNode ? E.filter((e) => e.to === activeNode.id) : [];
  const nodeOutputs = activeNode ? E.filter((e) => e.from === activeNode.id) : [];

  // Request list component (10 items visible, scroll container beyond)
  const RequestListComponent = (
    <Card padding="none" className="flex flex-col bg-surface-1 dark:bg-slate-950/80 border-border overflow-hidden">
      {/* Header of Request List */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-surface-2/60 dark:bg-slate-900/60">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[17px] text-primary">receipt_long</span>
          <span className="text-xs font-bold uppercase tracking-wider text-text-main font-mono">
            Requests
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface-3 text-text-muted">
            {filteredReqs.length}
          </span>
        </div>

        {/* Filter Pills inside List Header */}
        <div className="flex items-center gap-1">
          {[
            { id: "all", label: "Alle" },
            { id: "cache", label: "Cache" },
            { id: "stream", label: "Stream" },
            { id: "error", label: "Fehler" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                setSelIdx(0);
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                filter === f.id
                  ? "bg-primary text-white shadow-xs"
                  : "text-text-muted hover:text-text-main hover:bg-surface-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Container: Displays 10 items visible (~440px), then scroll */}
      <div className="max-h-[440px] overflow-y-auto custom-scrollbar p-1.5 space-y-1">
        {filteredReqs.length === 0 ? (
          <div className="p-6 text-center text-xs text-text-muted italic">
            Keine Requests für Filter &quot;{filter}&quot; gefunden.
          </div>
        ) : (
          filteredReqs.map((r, idx) => {
            const isSelected = sel?.i === r.i;
            const isErr = r.status === "error" || (r.code && r.code >= 400);

            return (
              <div
                key={r.i}
                onClick={() => setSelIdx(idx)}
                className={`relative flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-xs cursor-pointer select-none transition-all duration-150 border ${
                  isSelected
                    ? "bg-slate-900 text-white border-cyan-400 ring-1 ring-cyan-400/30 shadow-md shadow-cyan-500/20"
                    : "bg-surface-2/60 hover:bg-surface-3 text-text-main border-border/60 hover:border-text-muted/30"
                }`}
              >
                {/* Left accent bar for active item */}
                {isSelected && (
                  <span className="absolute -left-1 top-2 bottom-2 w-1 rounded-r-full bg-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                )}

                {/* Left details: Model + Provider + Time */}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`size-2 rounded-full shrink-0 ${
                      isErr
                        ? "bg-rose-500 animate-pulse"
                        : r.cached
                        ? "bg-emerald-400"
                        : "bg-cyan-400"
                    }`}
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold truncate max-w-[130px] sm:max-w-[170px]">
                        {r.model.split("/").pop()}
                      </span>
                      <span className="text-[10px] text-text-muted dark:text-slate-400 font-sans">
                        {r.provider}
                      </span>
                    </div>
                    <span className="text-[10px] text-text-muted font-mono leading-none">
                      {r.time}
                    </span>
                  </div>
                </div>

                {/* Right details: Latency + Badges */}
                <div className="flex items-center gap-1.5 shrink-0 font-mono">
                  <span className="text-[11px] font-bold text-cyan-500">
                    {r.total}ms
                  </span>

                  {r.cached && (
                    <span
                      className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold"
                      title="Cache HIT"
                    >
                      HIT
                    </span>
                  )}

                  {r.stream && (
                    <span
                      className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold"
                      title="SSE Stream"
                    >
                      SSE
                    </span>
                  )}

                  {isErr && (
                    <span
                      className="px-1.5 py-0.2 rounded text-[9px] bg-rose-500/15 text-rose-400 border border-rose-500/30 font-bold"
                      title="Fehler"
                    >
                      {r.code || "ERR"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4 select-none">
      {/* Laser Keyframe animation style */}
      <style>{`
        @keyframes flowLaser {
          from { stroke-dashoffset: 40; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes photonPulse {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 8px currentColor); }
          50% { transform: scale(1.15); filter: drop-shadow(0 0 16px currentColor); }
        }
      `}</style>

      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-2 rounded-full bg-cyan-400 animate-ping" />
          <h1 className="text-xl font-bold tracking-tight text-text-main">Request Flow</h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-500 font-bold border border-cyan-500/30">
            MESH
          </span>
        </div>

        {/* Live Controls & Mode Toggles */}
        <div className="flex items-center gap-2">
          {/* Layout Mode Toggle: Split vs Stacked */}
          <button
            type="button"
            onClick={() => setLayoutMode(layoutMode === "split" ? "stacked" : "split")}
            title={layoutMode === "split" ? "Auf Untereinander umschalten" : "Auf Seite-an-Seite umschalten"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-medium text-text-muted hover:text-text-main transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">
              {layoutMode === "split" ? "view_agenda" : "view_sidebar"}
            </span>
            <span className="hidden sm:inline">
              {layoutMode === "split" ? "Geteilt" : "Split"}
            </span>
          </button>

          {/* Replay Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={playFlowAnimation}
            disabled={isPlaying}
            title="Flow-Animation erneut abspielen"
            className="flex items-center gap-1.5"
          >
            <span className={`material-symbols-outlined text-[16px] text-primary ${isPlaying ? "animate-spin" : ""}`}>
              play_circle
            </span>
            <span className="hidden sm:inline text-xs">Replay</span>
          </Button>

          {/* Live Auto-Advance Toggle */}
          <button
            type="button"
            onClick={() => setIsLiveLoop((v) => !v)}
            title="Auto-Advance durch Requests"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              isLiveLoop
                ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                : "bg-surface-2 text-text-muted hover:text-text-main border-border"
            }`}
          >
            <span className={`material-symbols-outlined text-[15px] ${isLiveLoop ? "animate-spin" : ""}`}>
              autorenew
            </span>
            <span className="hidden sm:inline">Live Loop</span>
          </button>

          {/* Refresh Data */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={refreshing}
            className="flex items-center gap-1"
          >
            <span className={`material-symbols-outlined text-[15px] ${refreshing ? "animate-spin" : ""}`}>
              refresh
            </span>
          </Button>
        </div>
      </div>

      {/* Main Content Area: Split or Stacked */}
      <div className={`grid gap-4 ${layoutMode === "split" ? "grid-cols-1 xl:grid-cols-12" : "grid-cols-1"}`}>
        {/* Request List Column (in Split: left 4 cols, in Stacked: order below or above) */}
        <div className={layoutMode === "split" ? "xl:col-span-4 flex flex-col" : "w-full"}>
          {RequestListComponent}
        </div>

        {/* Diagram & Stepper Column (in Split: right 8 cols, in Stacked: w-full) */}
        <div className={`flex flex-col gap-4 ${layoutMode === "split" ? "xl:col-span-8" : "w-full"}`}>
          {/* Pipeline Stepper & Mini HUD */}
          {sel && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-surface-2/70 dark:bg-slate-900/60 border border-border backdrop-blur-md">
              {/* Stepper nodes */}
              <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
                {path.map((nodeId, idx) => {
                  const n = nodeById(nodeId);
                  return (
                    <div key={nodeId} className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setCard(card === nodeId ? null : nodeId)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                          card === nodeId
                            ? "bg-cyan-500 text-white border-cyan-400 shadow-sm"
                            : "bg-surface text-text-main border-border hover:border-cyan-400"
                        }`}
                      >
                        <span
                          className="size-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: DOT_COLOR_HEX[n?.group || "process"] }}
                        />
                        <span className="text-[11px] font-semibold">{n?.name || nodeId}</span>
                      </button>
                      {idx < path.length - 1 && (
                        <span className="material-symbols-outlined text-[13px] text-text-muted shrink-0">
                          arrow_forward
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quick Metrics */}
              <div className="flex items-center gap-3 text-xs font-mono text-text-muted shrink-0">
                <span>
                  Tokens: <strong className="text-text-main">{sel.tokIn}</strong> In /{" "}
                  <strong className="text-text-main">{sel.tokOut}</strong> Out
                </span>
                <span className="font-semibold text-text-main">{sel.time}</span>
              </div>
            </div>
          )}

          {/* Vector Mesh Canvas */}
          <Card padding="none" className="overflow-hidden bg-[#090d16] border-border shadow-2xl relative">
            {/* Stage Columns Label Header */}
            <div className="grid grid-cols-4 px-6 py-2 border-b border-white/5 bg-slate-900/40 text-[10px] font-mono tracking-widest uppercase text-slate-400">
              <div className="flex items-center gap-1.5 text-cyan-400">
                <span className="size-1.5 rounded-full bg-cyan-400" />
                1. INGESTION
              </div>
              <div className="flex items-center gap-1.5 text-indigo-400">
                <span className="size-1.5 rounded-full bg-indigo-400" />
                2. GATEWAY &amp; AUTH
              </div>
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="size-1.5 rounded-full bg-amber-400" />
                3. ENGINE &amp; STORAGE
              </div>
              <div className="flex items-center justify-end gap-1.5 text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                4. RESPONSE
              </div>
            </div>

            {/* SVG Mesh Canvas */}
            <div className="w-full relative p-2 sm:p-4 overflow-hidden">
              {/* Subtle Grid Pattern Background */}
              <div
                className="w-full relative"
                style={{
                  backgroundImage: "radial-gradient(rgba(56, 189, 248, 0.12) 1px, transparent 1px)",
                  backgroundSize: "28px 28px",
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
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto"
                    >
                      <path d="M0 0L10 5 0 10z" fill="#334155" />
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
                    <filter id="glow-blur" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {/* Edge Connecting Curves */}
                  <g>
                    {E.map((e) => {
                      const { d } = geo(e);
                      const isHot = hotKeys.has(key(e));
                      const isHovered = hoveredEdge === key(e);

                      return (
                        <g key={key(e)}>
                          {/* Interactive hover hit area */}
                          <path
                            d={d}
                            fill="none"
                            stroke="transparent"
                            strokeWidth="16"
                            onMouseEnter={() => setHoveredEdge(key(e))}
                            onMouseLeave={() => setHoveredEdge(null)}
                            className="cursor-pointer"
                          />

                          {/* Underglow beam for active paths */}
                          {isHot && (
                            <path
                              d={d}
                              fill="none"
                              stroke="#38bdf8"
                              strokeWidth="8"
                              opacity="0.25"
                              filter="url(#glow-blur)"
                            />
                          )}

                          {/* Base Core Line */}
                          <path
                            id={`fe-${key(e)}`}
                            d={d}
                            fill="none"
                            markerEnd={isHot ? "url(#flow-arrow-hot)" : "url(#flow-arrow)"}
                            strokeWidth={isHot ? 2.5 : isHovered ? 2 : 1.2}
                            className={
                              isHot
                                ? EDGE_COLOR[e.status || "hot"]
                                : isHovered
                                ? "stroke-sky-400"
                                : "stroke-slate-800"
                            }
                            style={{
                              opacity: isHot ? 1 : hotKeys.size ? 0.15 : 0.45,
                              transition: "all .3s ease",
                            }}
                          />

                          {/* Animated Laser Pulse Dash along active path */}
                          {isHot && (
                            <path
                              d={d}
                              fill="none"
                              stroke="#ffffff"
                              strokeWidth="2"
                              strokeDasharray="8 20"
                              style={{
                                animation: "flowLaser 0.9s linear infinite",
                                opacity: 0.9,
                              }}
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>

                  {/* Floating Dynamic Edge Tooltip on Hover */}
                  {hoveredEdge && (
                    <g>
                      {(() => {
                        const edgeObj = E.find((e) => key(e) === hoveredEdge);
                        if (!edgeObj) return null;
                        const { mx, my } = geo(edgeObj);
                        return (
                          <g transform={`translate(${mx}, ${my - 8})`}>
                            <rect
                              x="-45"
                              y="-10"
                              width="90"
                              height="20"
                              rx="6"
                              fill="#0f172a"
                              stroke="#38bdf8"
                              strokeWidth="1"
                              filter="drop-shadow(0 2px 8px rgba(0,0,0,0.6))"
                            />
                            <text
                              textAnchor="middle"
                              y="3.5"
                              fontSize="9"
                              fontFamily="monospace"
                              fill="#38bdf8"
                              fontWeight="bold"
                            >
                              {edgeObj.label}
                            </text>
                          </g>
                        );
                      })()}
                    </g>
                  )}

                  {/* Animated Flying Particles Container */}
                  <g id="flow-particles" />

                  {/* Nodes using ForeignObject for High-Definition Glass UI */}
                  {N.map((n) => {
                    const isSelected = card === n.id;
                    const isHot = inPath.has(n.id);
                    const isDimmed = inPath.size > 0 && !isHot;
                    const nodeColor = DOT_COLOR_HEX[n.group];

                    return (
                      <foreignObject
                        key={n.id}
                        x={n.x}
                        y={n.y}
                        width="190"
                        height="38"
                        className="overflow-visible"
                      >
                        <div
                          onClick={() => setCard(isSelected ? null : n.id)}
                          onMouseEnter={() => setHoveredNode(n.id)}
                          onMouseLeave={() => setHoveredNode(null)}
                          className={`w-[190px] h-[38px] rounded-xl flex items-center gap-2.5 px-3 cursor-pointer select-none transition-all duration-200 border ${
                            isSelected
                              ? "bg-slate-900 text-white border-cyan-400 ring-2 ring-cyan-400/50 shadow-xl shadow-cyan-500/30 scale-[1.04]"
                              : isHot
                              ? "bg-slate-900/95 text-white border-sky-400/80 shadow-lg shadow-sky-500/20 scale-[1.02]"
                              : isDimmed
                              ? "bg-slate-950/60 text-slate-500 border-slate-800/40 opacity-30 hover:opacity-100 hover:border-slate-600"
                              : "bg-slate-900/80 text-slate-200 border-slate-800 hover:border-indigo-400 hover:bg-slate-800/80"
                          }`}
                        >
                          {/* Node Icon Tile */}
                          <div
                            className="size-6 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                              backgroundColor: `${nodeColor}22`,
                              color: nodeColor,
                              border: `1px solid ${nodeColor}40`,
                            }}
                          >
                            <span className="material-symbols-outlined text-[15px]">
                              {NODE_ICONS[n.id] || "hub"}
                            </span>
                          </div>

                          {/* Node Name */}
                          <span className="text-[11.5px] font-semibold tracking-tight truncate flex-1">
                            {n.name}
                          </span>

                          {/* Status indicator pip */}
                          {isHot ? (
                            <span className="size-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
                          ) : (
                            <span
                              className="size-1.5 rounded-full shrink-0 opacity-60"
                              style={{ backgroundColor: nodeColor }}
                            />
                          )}
                        </div>
                      </foreignObject>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Selected Node Inspector (Compact Bottom Glass HUD) */}
            {activeNode && (
              <div className="p-3 sm:p-4 border-t border-white/10 bg-slate-950/90 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="size-7 rounded-lg flex items-center justify-center text-white"
                      style={{ backgroundColor: DOT_COLOR_HEX[activeNode.group] }}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {NODE_ICONS[activeNode.id] || "hub"}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white">{activeNode.name}</h3>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                          {activeNode.group}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{activeNode.desc}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCard(null)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                    aria-label="Schließen"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                {/* Quick Connection Jumps */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-2 border-t border-white/5 text-xs">
                  <span className="text-[10px] font-mono text-slate-400 uppercase">Verbindungen:</span>
                  {nodeInputs.map((e) => (
                    <button
                      key={key(e)}
                      type="button"
                      onClick={() => setCard(e.from)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-indigo-400 hover:border-indigo-500 text-[11px] transition-colors"
                    >
                      <span>← {nodeById(e.from)?.name}</span>
                    </button>
                  ))}
                  {nodeOutputs.map((e) => (
                    <button
                      key={key(e)}
                      type="button"
                      onClick={() => setCard(e.to)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-emerald-400 hover:border-emerald-500 text-[11px] transition-colors"
                    >
                      <span>→ {nodeById(e.to)?.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// Particle flight engine with glowing photon
function fly(edgeKey, color) {
  return new Promise((resolve) => {
    const pathEl = document.getElementById(`fe-${edgeKey}`);
    if (!pathEl) return resolve();
    const g = document.getElementById("flow-particles");
    if (!g) return resolve();
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("r", "5.5");
    c.setAttribute("fill", color || "#38bdf8");
    c.style.filter = `drop-shadow(0 0 8px ${color || "#38bdf8"})`;
    g.appendChild(c);
    const len = pathEl.getTotalLength();
    const start = performance.now();
    (function step(t) {
      const q = Math.min((t - start) / 380, 1);
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
