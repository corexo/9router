"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Card, Badge, Button, Input } from "@/shared/components";
import { usePersistentState } from "@/shared/hooks";

const PROVIDER_THEMES = {
  claude: { border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-500", glow: "shadow-amber-500/10", dot: "bg-amber-500" },
  anthropic: { border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-500", glow: "shadow-amber-500/10", dot: "bg-amber-500" },
  openai: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-500", glow: "shadow-emerald-500/10", dot: "bg-emerald-500" },
  codex: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-500", glow: "shadow-emerald-500/10", dot: "bg-emerald-500" },
  chatgpt: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-500", glow: "shadow-emerald-500/10", dot: "bg-emerald-500" },
  gemini: { border: "border-purple-500/40", bg: "bg-purple-500/10", text: "text-purple-500", glow: "shadow-purple-500/10", dot: "bg-purple-500" },
  glm: { border: "border-blue-500/40", bg: "bg-blue-500/10", text: "text-blue-500", glow: "shadow-blue-500/10", dot: "bg-blue-500" },
  deepseek: { border: "border-cyan-500/40", bg: "bg-cyan-500/10", text: "text-cyan-500", glow: "shadow-cyan-500/10", dot: "bg-cyan-500" },
  ollama: { border: "border-slate-500/40", bg: "bg-slate-500/10", text: "text-slate-400", glow: "shadow-slate-500/10", dot: "bg-slate-400" },
  "cloudflare-ai": { border: "border-orange-500/40", bg: "bg-orange-500/10", text: "text-orange-500", glow: "shadow-orange-500/10", dot: "bg-orange-500" },
};

function getProviderTheme(provider) {
  if (!provider) return { border: "border-border", bg: "bg-surface-2", text: "text-text-muted", glow: "", dot: "bg-brand-500" };
  const p = String(provider).toLowerCase();
  for (const [key, theme] of Object.entries(PROVIDER_THEMES)) {
    if (p.includes(key)) return theme;
  }
  return { border: "border-indigo-500/30", bg: "bg-indigo-500/10", text: "text-indigo-400", glow: "shadow-indigo-500/10", dot: "bg-indigo-500" };
}

function getModelContextLimit(provider, model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("1m") || m.includes("gemini") || m.includes("deepseek-v4") || m.includes("minimax-m3") || m.includes("mimo*v2.5")) {
    return 1000000;
  }
  if (m.includes("256k") || m.includes("kimi") || m.includes("codestral") || m.includes("mistral-large")) {
    return 262144;
  }
  if (m.includes("200k") || m.includes("claude") || m.includes("sonnet") || m.includes("opus") || m.includes("haiku") || m.includes("glm") || m.includes("laguna")) {
    return 200000;
  }
  if (m.includes("128k") || m.includes("gpt-4") || m.includes("o1") || m.includes("o3") || m.includes("deepseek") || m.includes("llama") || m.includes("qwen")) {
    return 128000;
  }
  return 128000;
}

function fmtTokens(n) {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) {
    const val = n / 1e6;
    return val >= 10 ? val.toFixed(1) + "M" : val.toFixed(2).replace(/\.00$/, "") + "M";
  }
  if (n >= 1e3) {
    const val = n / 1e3;
    return val >= 100 ? Math.round(val) + "K" : val.toFixed(1) + "K";
  }
  return Number(n).toLocaleString();
}

function timeAgo(dateString) {
  if (!dateString) return "—";
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 5) return "gerade eben";
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours}h`;
  return `vor ${Math.floor(hours / 24)}d`;
}

export default function ActiveSessionsVisualizer({ initialSessions = null }) {
  const [liveData, setLiveData] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterMode, setFilterMode] = usePersistentState("9r_cockpit_sessions_filter", "active"); // "active" | "all"
  const [viewMode, setViewMode] = usePersistentState("9r_cockpit_sessions_view", "cards"); // "cards" | "timeline"
  const [autoRefreshInterval, setAutoRefreshInterval] = usePersistentState("9r_cockpit_sessions_refresh", 5); // 0, 3, 5, 10
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [selectedPing, setSelectedPing] = useState(null);

  const sessionsData = liveData || initialSessions;

  // Fetch live sessions independently
  const fetchSessions = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/usage/cache-sessions?includeTurns=true", {
        headers: { "Cache-Control": "no-store" },
      });
      if (res.ok) {
        const json = await res.json();
        const all = json.sessions || [];
        const active = all.filter((s) => s.state === "active");
        setLiveData({
          active,
          all,
          activeCount: active.length,
          totalCount: all.length,
        });
      }
    } catch (err) {
      console.error("[ActiveSessionsVisualizer] Error fetching sessions:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Initial fetch if no initial data
  useEffect(() => {
    let active = true;
    if (!initialSessions) {
      fetch("/api/usage/cache-sessions?includeTurns=true")
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (active && json) {
            const all = json.sessions || [];
            const activeSessions = all.filter((s) => s.state === "active");
            setLiveData({
              active: activeSessions,
              all,
              activeCount: activeSessions.length,
              totalCount: all.length,
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [initialSessions]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const interval = setInterval(() => {
      fetchSessions(true);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, fetchSessions]);

  const copyId = async (id, e) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  const toggleKeepAlive = async (cacheId, currentVal, e) => {
    e?.stopPropagation();
    try {
      const nextVal = !currentVal;
      // Optimistic update
      setLiveData((prev) => {
        if (!prev) return prev;
        const updateSession = (s) => (s.cacheId === cacheId ? { ...s, keepAliveEnabled: nextVal } : s);
        return {
          ...prev,
          active: (prev.active || []).map(updateSession),
          all: (prev.all || []).map(updateSession),
        };
      });

      await fetch("/api/cache/keep-alive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggleSession", cacheId, enabled: nextVal }),
      });
      // Fetch fresh data
      fetchSessions(true);
    } catch (err) {
      console.error("[ActiveSessionsVisualizer] Failed to toggle keep-alive:", err);
    }
  };

  const activeSessions = useMemo(() => sessionsData?.active || [], [sessionsData]);
  const allSessions = useMemo(() => sessionsData?.all || [], [sessionsData]);

  const topSessions = useMemo(() => {
    return [...allSessions]
      .sort((a, b) => {
        if (b.requests !== a.requests) return b.requests - a.requests;
        return (Number(b.cachedTokens) || 0) - (Number(a.cachedTokens) || 0);
      })
      .slice(0, 5);
  }, [allSessions]);

  const displayedSessions = useMemo(() => {
    let base = activeSessions;
    if (filterMode === "all") base = allSessions;
    else if (filterMode === "top") base = topSessions;

    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter((s) => {
      if (s.cacheId?.toLowerCase().includes(q)) return true;
      if (s.provider?.toLowerCase().includes(q)) return true;
      if (s.models?.some((m) => m?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [filterMode, activeSessions, allSessions, topSessions, searchQuery]);

  // Aggregated live KPI metrics
  const sessionKpis = useMemo(() => {
    const activeCount = activeSessions.length;
    const totalCount = allSessions.length;
    let activePings = 0;
    let activeCachedTokens = 0;
    let activePromptTokens = 0;
    let activeCurrentContextSum = 0;
    let totalContextAll = 0;

    for (const s of activeSessions) {
      activePings += Number(s.requests || 0);
      activeCachedTokens += Number(s.cachedTokens || 0);
      const prompt = Number(s.promptTokens || 0);
      activePromptTokens += prompt;
      const latestTurn = s.turns?.[0];
      const curCtx = latestTurn?.promptTokens > 0 ? Number(latestTurn.promptTokens) : prompt;
      activeCurrentContextSum += curCtx;
    }

    for (const s of allSessions) {
      const turns = s.turns || [];
      const prompt = Number(s.promptTokens || 0);
      const cum = Math.max(prompt, turns.reduce((acc, t) => acc + Number(t.promptTokens || 0), 0));
      totalContextAll += cum;
    }

    const hitRate = activePromptTokens > 0
      ? Math.min(100, (activeCachedTokens / activePromptTokens) * 100)
      : 0;

    return {
      activeCount,
      totalCount,
      activePings,
      activeCachedTokens,
      activePromptTokens,
      activeCurrentContextSum,
      totalContextAll,
      hitRate: Number(hitRate.toFixed(1)),
    };
  }, [activeSessions, allSessions]);

  // Interleaved timeline of recent pings across displayed sessions
  const interleavedPings = useMemo(() => {
    const list = [];
    for (const s of displayedSessions) {
      const turns = s.turns || [];
      turns.forEach((turn, idx) => {
        list.push({
          ...turn,
          sessionCacheId: s.cacheId,
          sessionState: s.state,
          turnNumber: turns.length - idx,
          totalSessionTurns: turns.length,
          provider: turn.provider || s.provider || "unknown",
          model: turn.model || s.models?.[0] || "unknown",
          isRecent: s.state === "active" && idx === 0,
        });
      });
    }
    return list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 35);
  }, [displayedSessions]);

  return (
    <Card padding="md" className="border-border/80 bg-gradient-to-b from-surface to-surface-2/20">
      {/* Header Bar */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 mb-4 pb-3.5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3.5 w-3.5">
            {sessionKpis.activeCount > 0 ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-slate-400 dark:bg-slate-600" />
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-text-main tracking-tight flex items-center gap-2">
                <span>Aktive Sessions &amp; Live-Pings</span>
              </h2>
              {sessionKpis.activeCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {sessionKpis.activeCount} aktiv
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-3 text-text-muted border border-border">
                  Standby
                </span>
              )}
              <span className="text-xs text-text-muted font-mono">
                ({sessionKpis.totalCount} im Speicher)
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Visuelle Überwachung aller Client-Konversationen, deren einzelne Request-Pings und Prompt-Cache-Effizienz
            </p>
          </div>
        </div>

        {/* Live Aggregated Indicators */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {sessionKpis.activeCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono">
              <span className="material-symbols-outlined text-[15px]">bolt</span>
              <span>{sessionKpis.hitRate}% Cache-Hit</span>
            </div>
          )}

          {/* Context Size (Active Sum) */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400 font-mono" title="Summe der aktiven Kontextgrößen der letzten Turns">
            <span className="material-symbols-outlined text-[15px]">data_usage</span>
            <span>Kontextgröße: {fmtTokens(sessionKpis.activeCurrentContextSum)}</span>
          </div>

          {/* Total Context */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-mono" title="Kumulierter Gesamt-Kontext über alle Sessions">
            <span className="material-symbols-outlined text-[15px]">layers</span>
            <span>Gesamt-Kontext: {fmtTokens(sessionKpis.totalContextAll)}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-border text-text-main font-mono">
            <span className="material-symbols-outlined text-[15px] text-brand-500">sync_alt</span>
            <span>{sessionKpis.activePings} Pings</span>
          </div>

          {/* Filter: Active vs Top vs All */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border font-medium">
            <button
              onClick={() => setFilterMode("active")}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                filterMode === "active"
                  ? "bg-brand-500 text-white shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Nur Aktive ({sessionKpis.activeCount})
            </button>
            <button
              onClick={() => setFilterMode("top")}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1 ${
                filterMode === "top"
                  ? "bg-amber-500 text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">local_fire_department</span>
              <span>Top 5</span>
            </button>
            <button
              onClick={() => setFilterMode("all")}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                filterMode === "all"
                  ? "bg-brand-500 text-white shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Alle ({sessionKpis.totalCount})
            </button>
          </div>

          {/* View Mode: Cards vs Timeline */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border font-medium">
            <button
              onClick={() => setViewMode("cards")}
              title="Visuelle Session-Karten mit Ping-Tracks"
              className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors ${
                viewMode === "cards"
                  ? "bg-surface-3 text-text-main font-semibold shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">grid_view</span>
              <span className="hidden sm:inline">Karten</span>
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              title="Kompakter chronologischer Ping-Stream"
              className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors ${
                viewMode === "timeline"
                  ? "bg-surface-3 text-text-main font-semibold shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">waterfall_chart</span>
              <span className="hidden sm:inline">Ping-Stream</span>
            </button>
          </div>

          {/* Auto Refresh Speed */}
          <div className="flex items-center bg-surface-2 rounded-lg p-0.5 border border-border text-xs">
            <span className="px-1.5 text-text-muted">Auto:</span>
            {[
              { label: "Aus", val: 0 },
              { label: "3s", val: 3 },
              { label: "5s", val: 5 },
              { label: "10s", val: 10 },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => setAutoRefreshInterval(opt.val)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  autoRefreshInterval === opt.val
                    ? "bg-brand-500 text-white shadow-sm"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchSessions(false)}
            disabled={isRefreshing}
            className="flex items-center gap-1 px-2.5 py-1 text-xs"
          >
            <span className={`material-symbols-outlined text-[15px] ${isRefreshing ? "animate-spin" : ""}`}>
              refresh
            </span>
          </Button>
        </div>
      </div>

      {/* Optional Search Bar when many sessions exist */}
      {allSessions.length > 3 && (
        <div className="mb-4 max-w-sm">
          <Input
            icon="search"
            placeholder="Nach Modell, Provider oder ID filtern..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="sm"
          />
        </div>
      )}

      {/* Main Content Area */}
      {displayedSessions.length === 0 ? (
        /* Empty State / Standby Radar */
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center rounded-xl bg-surface-2/30 border border-dashed border-border">
          <div className="relative mb-3.5 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-brand-500/5 border border-brand-500/20 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-brand-500/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[24px] text-brand-500 animate-pulse">
                  radar
                </span>
              </div>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-text-main">
            {filterMode === "active"
              ? "Keine aktiven Sessions im 5-Minuten-Zeitfenster"
              : "Keine Sessions im Cache gefunden"}
          </h3>
          <p className="text-xs text-text-muted max-w-md mt-1 mb-3.5">
            {filterMode === "active"
              ? "Sobald deine Coding-Assistenten (Cursor, Claude Code, Cline, Roo, OpenCode etc.) Anfragen senden, leuchten sie hier in Echtzeit mit jedem Ping auf."
              : "Sende eine Anfrage über den OpenAI-kompatiblen Port (z.B. /v1/chat/completions), um Konversationen zu erfassen."}
          </p>
          {filterMode === "active" && allSessions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilterMode("all")}
              className="text-xs flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[15px]">history</span>
              <span>{allSessions.length} kürzliche Sessions anzeigen</span>
            </Button>
          )}
        </div>
      ) : viewMode === "cards" ? (
        /* Cards View: Grid of Visual Session Lanes with Ping Waveforms */
        <div className="grid grid-cols-1 gap-4">
          {displayedSessions.map((session) => {
            const providerTheme = getProviderTheme(session.provider);
            const turns = session.turns || [];
            const promptNum = Number(session.promptTokens || 0);
            const cachedNum = Number(session.cachedTokens || 0);
            const hitRatio = promptNum > 0 ? Math.min(100, (cachedNum / promptNum) * 100) : 0;
            const isExpanded = expandedSessionId === session.cacheId;
            const isActive = session.state === "active";

            const latestTurn = turns[0];
            const currentContextSize = latestTurn?.promptTokens > 0 ? Number(latestTurn.promptTokens) : promptNum;
            const totalContext = Math.max(promptNum, turns.reduce((acc, t) => acc + Number(t.promptTokens || 0), 0));
            const maxContext = getModelContextLimit(session.provider, session.models?.[0]);
            const contextUtilization = maxContext > 0 ? Math.min(100, (currentContextSize / maxContext) * 100) : 0;

            return (
              <div
                key={session.cacheId}
                className={`rounded-xl border transition-all ${
                  isActive
                    ? "border-emerald-500/40 bg-surface shadow-sm shadow-emerald-500/5 hover:border-emerald-500/60"
                    : "border-border/80 bg-surface/70 hover:border-border"
                } overflow-hidden`}
              >
                {/* Session Card Header */}
                <div className="p-3.5 sm:p-4 bg-surface-2/40 border-b border-border/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Status Pill */}
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-2.5 w-2.5">
                        {isActive ? (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                          </>
                        ) : (
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-400 dark:bg-slate-600" />
                        )}
                      </span>
                      <span className={`text-xs font-bold uppercase tracking-wider ${isActive ? "text-emerald-600 dark:text-emerald-400" : "text-text-muted"}`}>
                        {isActive ? "AKTIV" : "IDLE"}
                      </span>
                    </div>

                    {/* Cache ID Chip */}
                    <div className="flex items-center gap-1 bg-surface-3 px-2 py-0.5 rounded-md border border-border/80">
                      <span className="font-mono text-xs font-semibold text-text-main">
                        #{session.cacheId}
                      </span>
                      <button
                        onClick={(e) => copyId(session.cacheId, e)}
                        className="text-text-muted hover:text-text-main transition-colors ml-0.5"
                        title="ID kopieren"
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {copiedId === session.cacheId ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>

                    {/* Provider Badge */}
                    {session.provider && (
                      <span className={`px-2 py-0.5 rounded-md text-xs font-mono font-semibold uppercase border ${providerTheme.bg} ${providerTheme.border} ${providerTheme.text}`}>
                        {session.provider}
                      </span>
                    )}

                    {/* Models List */}
                    <div className="flex flex-wrap items-center gap-1">
                      {(session.models || []).map((m) => (
                        <span
                          key={m}
                          className="px-2 py-0.5 rounded-md text-xs font-mono bg-surface-3 text-text-main border border-border truncate max-w-[200px]"
                          title={m}
                        >
                          {m}
                        </span>
                      ))}
                    </div>

                    {/* Context Size Badge */}
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-600 dark:text-cyan-400 font-mono text-xs" title={`Aktuelle Kontextgröße: ${Number(currentContextSize).toLocaleString()} von ${Number(maxContext).toLocaleString()} (${contextUtilization.toFixed(1)}%)`}>
                      <span className="material-symbols-outlined text-[13px]">data_usage</span>
                      <span className="text-text-muted">Kontext:</span>
                      <span className="font-semibold">{fmtTokens(currentContextSize)}</span>
                      <span className="text-text-muted text-[10px]">/ {fmtTokens(maxContext)}</span>
                    </div>

                    {/* Total Context Badge */}
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/25 text-indigo-600 dark:text-indigo-400 font-mono text-xs" title={`Insgesamt verarbeiteter Kontext über alle Turns: ${Number(totalContext).toLocaleString()} Tokens`}>
                      <span className="material-symbols-outlined text-[13px]">layers</span>
                      <span className="text-text-muted">Gesamt:</span>
                      <span className="font-semibold">{fmtTokens(totalContext)}</span>
                    </div>

                    {/* Session Sticky Account Pin */}
                    {session.connectionId && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 font-mono text-xs" title={`Gepinnter Account für Prompt-Caching (Session-Stickiness): ${session.connectionId}`}>
                        <span className="material-symbols-outlined text-[13px]">lock</span>
                        <span className="text-text-muted">Account:</span>
                        <span className="font-semibold">#{session.connectionId.slice(0, 8)}</span>
                      </div>
                    )}
                  </div>

                  {/* Right Header Stats & Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 self-end sm:self-auto text-xs">
                    {/* Keep-Alive TTL / Health Badge */}
                    {session.ttlRemainingSecs != null && session.ttlRemainingSecs > 0 ? (
                      <div
                        className={`flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] border ${
                          session.ttlRemainingSecs < 60
                            ? "bg-rose-500/10 text-rose-500 border-rose-500/30 animate-pulse"
                            : session.ttlRemainingSecs < 120
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                            : "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                        }`}
                        title={`Upstream Prompt Cache TTL: noch ${Math.floor(session.ttlRemainingSecs / 60)}m ${session.ttlRemainingSecs % 60}s bis zur Eviction`}
                      >
                        <span className="material-symbols-outlined text-[13px]">timer</span>
                        <span>{Math.floor(session.ttlRemainingSecs / 60)}:{(session.ttlRemainingSecs % 60).toString().padStart(2, "0")}</span>
                      </div>
                    ) : null}

                    {/* Keep-Alive Toggle Switch */}
                    <button
                      onClick={(e) => toggleKeepAlive(session.cacheId, session.keepAliveEnabled, e)}
                      title={session.keepAliveEnabled ? "Keep-Alive ist aktiv (Proaktiver 4-Minuten Ping aktiviert)" : "Keep-Alive aktivieren (Hält Upstream-Cache vor TTL-Ablauf warm)"}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium transition-all border ${
                        session.keepAliveEnabled
                          ? "bg-amber-500/15 text-amber-500 border-amber-500/40 shadow-sm shadow-amber-500/10"
                          : "bg-surface-3 text-text-muted border-border hover:text-text-main"
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[14px] ${session.keepAliveEnabled ? "animate-pulse" : ""}`}>
                        {session.keepAliveEnabled ? "bolt" : "power_settings_new"}
                      </span>
                      <span>{session.keepAliveEnabled ? "Keep-Alive" : "Keep-Alive: Aus"}</span>
                    </button>

                    <div className="flex items-center gap-1 text-text-muted font-mono">
                      <span className="material-symbols-outlined text-[15px] text-amber-500">sync_alt</span>
                      <span className="font-semibold text-text-main">{session.requests} Pings</span>
                    </div>

                    <div className="text-text-muted font-mono whitespace-nowrap">
                      {timeAgo(session.lastActive)}
                    </div>

                    <Link
                      href={`/dashboard/cache-sessions/${session.cacheId}`}
                      className="text-brand-500 hover:text-brand-600 inline-flex items-center gap-0.5 font-medium hover:underline"
                    >
                      <span>Detail</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  </div>
                </div>

                {/* Body: Context Size & Total Context Metrics */}
                <div className="p-3.5 sm:p-4 space-y-3.5">
                  {/* Context Size & Total Context Dashboard Gauges */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg bg-surface-2/40 border border-border/60">
                    {/* Gauge 1: Context Window (Aktuelle Kontextgröße) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[15px] text-cyan-500">data_usage</span>
                          <span className="text-text-muted">Kontextgröße (Aktuell):</span>
                          <span className="font-bold text-text-main">{Number(currentContextSize).toLocaleString()} Tokens</span>
                        </div>
                        <div className="text-[11px] text-text-muted">
                          Max: <span className="text-text-main font-semibold">{fmtTokens(maxContext)}</span> ({contextUtilization.toFixed(1)}%)
                        </div>
                      </div>

                      {/* Visual Context Window Bar */}
                      <div className="w-full h-2 rounded-full bg-surface-3 overflow-hidden flex">
                        <div
                          className={`h-full transition-all duration-300 rounded-full ${
                            contextUtilization > 85
                              ? "bg-rose-500"
                              : contextUtilization > 60
                              ? "bg-amber-500"
                              : "bg-cyan-500"
                          }`}
                          style={{ width: `${Math.max(2, Math.min(100, contextUtilization))}%` }}
                          title={`Kontextgröße: ${Number(currentContextSize).toLocaleString()} / ${Number(maxContext).toLocaleString()} Tokens (${contextUtilization.toFixed(1)}%)`}
                        />
                      </div>
                    </div>

                    {/* Gauge 2: Total Cumulative Context & KV-Cache */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[15px] text-indigo-500">layers</span>
                          <span className="text-text-muted">Insgesamt Kontext:</span>
                          <span className="font-bold text-text-main">{Number(totalContext).toLocaleString()} Tokens</span>
                        </div>
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[13px]">bolt</span>
                          <span>{fmtTokens(cachedNum)} ({hitRatio.toFixed(1)}% Hit)</span>
                        </div>
                      </div>

                      {/* Visual Cache Ratio Bar */}
                      <div className="w-full h-2 rounded-full bg-surface-3 overflow-hidden flex">
                        <div
                          className="bg-emerald-500 transition-all duration-300 rounded-l-full"
                          style={{ width: `${Math.min(100, hitRatio)}%` }}
                          title={`Gecacht: ${Number(cachedNum).toLocaleString()} Tokens (${hitRatio.toFixed(1)}%)`}
                        />
                        <div
                          className="bg-indigo-500/60 transition-all duration-300"
                          style={{ width: `${Math.max(0, 100 - hitRatio)}%` }}
                          title={`Neuer Kontext-Input: ${Number(Math.max(0, totalContext - cachedNum)).toLocaleString()} Tokens`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* VISUAL PING STREAM / WAVEFORM */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                        <span className="material-symbols-outlined text-[16px] text-brand-500">timeline</span>
                        <span>Visuelle Ping-Sequenz ({turns.length} erfasst)</span>
                      </div>
                      <button
                        onClick={() => setExpandedSessionId(isExpanded ? null : session.cacheId)}
                        className="text-xs text-text-muted hover:text-text-main flex items-center gap-1 font-mono transition-colors"
                      >
                        <span>{isExpanded ? "Tabelle verbergen" : "Tabelle aufklappen"}</span>
                        <span className="material-symbols-outlined text-[14px]">
                          {isExpanded ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                    </div>

                    {/* Horizontal Visual Ping Sequence Track */}
                    {turns.length > 0 ? (
                      <div className="relative overflow-x-auto pb-2 scrollbar-thin">
                        <div className="flex items-center gap-2 min-w-max py-1 px-0.5">
                          {/* Chronological order from oldest turn to newest */}
                          {[...turns].reverse().map((turn, tIdx) => {
                            const isHit = turn.cacheActive || (Number(turn.cachedTokens) > 0);
                            const tPrompt = Number(turn.promptTokens || 0);
                            const tCached = Number(turn.cachedTokens || 0);
                            const tRatio = tPrompt > 0 ? (tCached / tPrompt) * 100 : 0;
                            const isLatest = tIdx === turns.length - 1;

                            return (
                              <div
                                key={tIdx}
                                onClick={() => setSelectedPing({ ...turn, pingNumber: tIdx + 1, sessionId: session.cacheId })}
                                className={`group relative flex flex-col justify-between p-2 rounded-lg border transition-all cursor-pointer ${
                                  isLatest && isActive
                                    ? "ring-2 ring-emerald-500/50 shadow-md shadow-emerald-500/10"
                                    : ""
                                } ${
                                  isHit
                                    ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                                    : "bg-surface-2/80 hover:bg-surface-3 border-border text-text-main"
                                } w-[134px] shrink-0 select-none`}
                              >
                                {/* Top Tag: Ping Index & Relative Time */}
                                <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                                  <span className="font-bold text-text-main flex items-center gap-0.5">
                                    <span>#{tIdx + 1}</span>
                                    {isLatest && isActive && (
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5" />
                                    )}
                                  </span>
                                  <span className="text-[10px] text-text-muted">
                                    {timeAgo(turn.timestamp)}
                                  </span>
                                </div>

                                {/* Visual Mini Bar of this ping */}
                                <div className="w-full h-1.5 rounded bg-surface-3 overflow-hidden flex my-1">
                                  {isHit ? (
                                    <div
                                      className="bg-emerald-500 h-full rounded"
                                      style={{ width: `${Math.max(15, Math.min(100, tRatio))}%` }}
                                    />
                                  ) : (
                                    <div className="bg-indigo-500 h-full rounded w-full" />
                                  )}
                                </div>

                                {/* Token info & badge */}
                                <div className="mt-1 flex items-center justify-between text-[10px] font-mono">
                                  <span className="text-text-muted truncate max-w-[70px]" title={`Kontext: ${tPrompt.toLocaleString()}`}>
                                    {fmtTokens(tPrompt)} ctx
                                  </span>
                                  {isHit ? (
                                    <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-[9px] flex items-center gap-0.5">
                                      <span className="material-symbols-outlined text-[10px]">bolt</span>
                                      HIT
                                    </span>
                                  ) : (
                                    <span className="px-1 py-0.2 rounded bg-surface-3 text-text-muted text-[9px]">
                                      LIVE
                                    </span>
                                  )}
                                </div>

                                {turn.latencyMs != null && (
                                  <div className="mt-1 text-[9px] font-mono text-text-muted text-right">
                                    {turn.latencyMs}ms
                                  </div>
                                )}

                                {/* Hover tooltip preview */}
                                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col gap-0.5 z-30 p-2.5 rounded-lg bg-surface-3 text-text-main border border-border shadow-xl text-[11px] font-mono whitespace-nowrap min-w-[170px]">
                                  <div className="font-bold text-xs text-text-main flex items-center justify-between border-b border-border pb-1 mb-1">
                                    <span>Ping #{tIdx + 1}</span>
                                    <span className="text-text-muted font-normal">{new Date(turn.timestamp).toLocaleTimeString()}</span>
                                  </div>
                                  <div className="text-text-muted">Modell: <span className="text-text-main">{turn.model || session.models?.[0] || "—"}</span></div>
                                  <div className="text-text-muted">Kontextgröße: <span className="text-cyan-400 font-semibold">{Number(tPrompt).toLocaleString()}</span></div>
                                  <div className="text-text-muted">Gecacht: <span className={isHit ? "text-emerald-400 font-semibold" : "text-text-main"}>{Number(tCached).toLocaleString()} ({tRatio.toFixed(1)}%)</span></div>
                                  <div className="text-text-muted">Neuer Input: <span className="text-indigo-400">{Number(Math.max(0, tPrompt - tCached)).toLocaleString()}</span></div>
                                  {turn.completionTokens != null && (
                                    <div className="text-text-muted">Output: <span className="text-text-main">{Number(turn.completionTokens).toLocaleString()}</span></div>
                                  )}
                                  {turn.latencyMs != null && (
                                    <div className="text-text-muted">Latenz: <span className="text-amber-400">{turn.latencyMs}ms</span></div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 text-center text-xs text-text-muted bg-surface-2/40 rounded-lg">
                        Noch keine detaillierten Turn-Pings aufgezeichnet.
                      </div>
                    )}
                  </div>

                  {/* Expanded Turn-by-Turn Table View */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-border overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border bg-surface-2/50 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                            <th className="p-2">#</th>
                            <th className="p-2">Zeitpunkt</th>
                            <th className="p-2">Modell</th>
                            <th className="p-2">Provider</th>
                            <th className="p-2 text-right">Kontextgröße (Prompt)</th>
                            <th className="p-2 text-right text-emerald-600 dark:text-emerald-400">Gecachter Kontext</th>
                            <th className="p-2 text-right">Latenz</th>
                            <th className="p-2 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border font-mono">
                          {turns.map((t, idx) => {
                            const isHit = t.cacheActive || (Number(t.cachedTokens) > 0);
                            return (
                              <tr key={idx} className="hover:bg-surface-2/50 transition-colors">
                                <td className="p-2 text-text-muted font-bold">{turns.length - idx}</td>
                                <td className="p-2 text-text-muted whitespace-nowrap">
                                  {new Date(t.timestamp).toLocaleTimeString()} ({timeAgo(t.timestamp)})
                                </td>
                                <td className="p-2 font-semibold text-text-main">{t.model || "—"}</td>
                                <td className="p-2 text-text-muted">{t.provider || "—"}</td>
                                <td className="p-2 text-right text-text-main">{fmtTokens(t.promptTokens)}</td>
                                <td className="p-2 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                                  {t.cachedTokens > 0 ? fmtTokens(t.cachedTokens) : "—"}
                                </td>
                                <td className="p-2 text-right text-text-muted">
                                  {t.latencyMs != null ? `${t.latencyMs}ms` : "—"}
                                </td>
                                <td className="p-2 text-right">
                                  {isHit ? (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                      CACHE HIT
                                    </span>
                                  ) : (
                                    <span className="text-text-muted text-[10px]">LIVE</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Timeline View: Chronological Ping Stream across all sessions */
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center justify-between">
            <span>Zusammenhängender Ping-Stream ({interleavedPings.length} letzte Anfragen)</span>
            <span className="text-[11px] text-text-muted font-normal">Klicke auf einen Ping für Details</span>
          </div>

          <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-surface">
            {interleavedPings.map((p, idx) => {
              const isHit = p.cacheActive || (Number(p.cachedTokens) > 0);
              const pTheme = getProviderTheme(p.provider);
              const isRecent = p.isRecent;

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedPing(p)}
                  className={`p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-surface-2/50 transition-colors cursor-pointer ${
                    isRecent ? "bg-emerald-500/5" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
                    <span className="text-text-muted font-bold min-w-[28px]">
                      #{idx + 1}
                    </span>

                    <span className="text-text-muted text-[11px] whitespace-nowrap">
                      {new Date(p.timestamp).toLocaleTimeString()} ({timeAgo(p.timestamp)})
                    </span>

                    {/* Session Pill */}
                    <span className="px-2 py-0.5 rounded bg-surface-3 border border-border text-text-main font-semibold">
                      Session #{p.sessionCacheId}
                    </span>

                    {/* Provider */}
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${pTheme.bg} ${pTheme.border} ${pTheme.text}`}>
                      {p.provider}
                    </span>

                    {/* Model */}
                    <span className="text-text-main font-semibold truncate max-w-[200px]" title={p.model}>
                      {p.model}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs self-end sm:self-auto">
                    <span className="text-text-main flex items-center gap-1">
                      <span className="text-text-muted text-[11px]">Kontext:</span>
                      <span className="font-semibold">{fmtTokens(p.promptTokens)}</span>
                    </span>

                    {isHit ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px]">
                        <span className="material-symbols-outlined text-[13px]">bolt</span>
                        {fmtTokens(p.cachedTokens)} Cache
                      </span>
                    ) : (
                      <span className="text-text-muted px-2 py-0.5 rounded bg-surface-2 text-[11px]">
                        Live
                      </span>
                    )}

                    {p.latencyMs != null && (
                      <span className="text-amber-500 font-semibold text-[11px]">
                        {p.latencyMs}ms
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Ping Detail Modal */}
      {selectedPing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-lg rounded-2xl bg-surface border border-border shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-brand-500/10 text-brand-500">
                  <span className="material-symbols-outlined text-[18px]">terminal</span>
                </span>
                <div>
                  <h3 className="text-sm font-bold text-text-main">
                    Ping #{selectedPing.pingNumber || selectedPing.turnNumber || "—"} Details
                  </h3>
                  <p className="text-xs text-text-muted">
                    Session #{selectedPing.sessionId || selectedPing.sessionCacheId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPing(null)}
                className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-surface-2 border border-border">
                <span className="text-text-muted block text-[10px] uppercase">Zeitpunkt</span>
                <span className="text-text-main font-semibold">{new Date(selectedPing.timestamp).toLocaleString()}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-2 border border-border">
                <span className="text-text-muted block text-[10px] uppercase">Latenz</span>
                <span className="text-text-main font-semibold">
                  {selectedPing.latencyMs != null ? `${selectedPing.latencyMs}ms` : "—"}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-2 border border-border">
                <span className="text-text-muted block text-[10px] uppercase">Provider</span>
                <span className="text-text-main font-semibold">{selectedPing.provider || "—"}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-2 border border-border">
                <span className="text-text-muted block text-[10px] uppercase">Modell</span>
                <span className="text-text-main font-semibold truncate block" title={selectedPing.model}>
                  {selectedPing.model || "—"}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-2 border border-border">
                <span className="text-text-muted block text-[10px] uppercase">Kontextgröße (Prompt)</span>
                <span className="text-text-main font-semibold">{Number(selectedPing.promptTokens || 0).toLocaleString()}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-2 border border-border">
                <span className="text-text-muted block text-[10px] uppercase">Gecachte Tokens</span>
                <span className="text-emerald-500 font-semibold">{Number(selectedPing.cachedTokens || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <Link
                href={`/dashboard/cache-sessions/${selectedPing.sessionId || selectedPing.sessionCacheId}`}
                className="text-xs font-medium text-brand-500 hover:underline flex items-center gap-1"
              >
                <span>Zur kompletten Cache-Session</span>
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </Link>
              <Button size="sm" onClick={() => setSelectedPing(null)}>
                Schließen
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
