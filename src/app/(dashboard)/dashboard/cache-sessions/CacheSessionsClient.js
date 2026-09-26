"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardSkeleton, Input } from "@/shared/components";

function fmtTokens(n) {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
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

function hitRate(cachedTokens, promptTokens) {
  if (!promptTokens || promptTokens <= 0) return null;
  return Math.min(100, (cachedTokens / promptTokens) * 100);
}

export default function CacheSessionsClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(5); // in seconds, 0 = off
  const [expandedSession, setExpandedSession] = useState(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setIsRefreshing(true);
    try {
      const res = await fetch("/api/usage/cache-sessions");
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error("[CacheSessions] Error loading sessions:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh timer
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const interval = setInterval(() => {
      fetchData(true);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, fetchData]);

  async function copyId(id) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard unavailable fallback
    }
  }

  const sessions = useMemo(() => data?.sessions || [], [data]);

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => {
      if (s.cacheId?.toLowerCase().includes(q)) return true;
      if (s.provider?.toLowerCase().includes(q)) return true;
      if (s.models?.some((m) => m?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [sessions, searchQuery]);

  // Aggregated KPI Stats
  const stats = useMemo(() => {
    let activeCount = 0;
    let idleCount = 0;
    let totalPrompt = 0;
    let totalCached = 0;
    let totalRequests = 0;

    for (const s of sessions) {
      if (s.state === "active") activeCount++;
      else idleCount++;
      totalPrompt += Number(s.promptTokens) || 0;
      totalCached += Number(s.cachedTokens) || 0;
      totalRequests += Number(s.requests) || 0;
    }

    const overallHitRate = totalPrompt > 0 ? (totalCached / totalPrompt) * 100 : 0;

    return {
      activeCount,
      idleCount,
      totalSessions: sessions.length,
      totalPrompt,
      totalCached,
      totalRequests,
      overallHitRate,
    };
  }, [sessions]);

  if (loading && !data) return <CardSkeleton />;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-text-main tracking-tight">Cache Sessions</h1>
            {stats.activeCount > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {stats.activeCount} aktiv
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mt-1">
            Echtzeit-Übersicht aller Omni- und Agenten-Sessions, Prompt-Cache-Akkumulation und Sticky-Modelle.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Auto Refresh Toggle */}
          <div className="flex items-center bg-surface-2 rounded-lg p-0.5 border border-border text-xs">
            <span className="px-2 text-text-muted">Auto:</span>
            {[
              { label: "Aus", val: 0 },
              { label: "3s", val: 3 },
              { label: "5s", val: 5 },
              { label: "10s", val: 10 },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => setAutoRefreshInterval(opt.val)}
                className={`px-2 py-1 rounded font-medium transition-colors ${
                  autoRefreshInterval === opt.val
                    ? "bg-brand-500 text-white shadow-sm"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(false)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5"
          >
            <span className={`material-symbols-outlined text-[16px] ${isRefreshing ? "animate-spin" : ""}`}>
              refresh
            </span>
            <span>Aktualisieren</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium uppercase tracking-wider">
            <span>Sessions</span>
            <span className="material-symbols-outlined text-[18px]">forum</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-text-main">{stats.totalSessions}</span>
            <span className="text-xs text-text-muted">
              ({stats.activeCount} aktiv, {stats.idleCount} idle)
            </span>
          </div>
          <div className="mt-1 text-xs text-text-muted">In-Memory (2h TTL)</div>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium uppercase tracking-wider">
            <span>Gecachte Tokens</span>
            <span className="material-symbols-outlined text-[18px] text-emerald-500">bolt</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {fmtTokens(stats.totalCached)}
            </span>
            <span className="text-xs text-text-muted">/ {fmtTokens(stats.totalPrompt)}</span>
          </div>
          <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Upstream KV-Cache Ersparnis</div>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium uppercase tracking-wider">
            <span>Cache Hit-Rate</span>
            <span className="material-symbols-outlined text-[18px]">analytics</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-text-main">
              {stats.overallHitRate.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 text-xs text-text-muted">Über alle aktiven Sessions</div>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted text-xs font-medium uppercase tracking-wider">
            <span>Requests Gesamt</span>
            <span className="material-symbols-outlined text-[18px]">sync_alt</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-text-main">{stats.totalRequests}</span>
          </div>
          <div className="mt-1 text-xs text-text-muted">Durch PiRouter geroutet</div>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="w-full sm:w-72">
          <Input
            icon="search"
            placeholder="Modell, Provider oder ID filtern..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {searchQuery && (
          <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
            Zurücksetzen
          </Button>
        )}
      </div>

      {/* Main Sessions Table */}
      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-xs font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-4">Cache-ID</th>
                <th className="p-4">Status</th>
                <th className="p-4">Provider</th>
                <th className="p-4">Modell(e)</th>
                <th className="p-4 text-right">Prompt-Tokens</th>
                <th className="p-4 text-right text-emerald-600 dark:text-emerald-400">Gecacht</th>
                <th className="p-4 text-right">Hit-Rate</th>
                <th className="p-4 text-right">Requests</th>
                <th className="p-4 text-right">Letzte Aktivität</th>
                <th className="p-4 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSessions.length > 0 ? (
                filteredSessions.map((session) => {
                  const rate = hitRate(session.cachedTokens, session.promptTokens);
                  return (
                    <tr
                      key={session.cacheId}
                      className="hover:bg-surface-2/40 transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/cache-sessions/${session.cacheId}`}
                            className="font-mono text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
                            title="Detail-Seite öffnen"
                          >
                            <span>{session.cacheId.slice(0, 8)}…</span>
                          </Link>
                          <button
                            onClick={() => copyId(session.cacheId)}
                            className="p-1 rounded text-text-muted hover:text-text-main transition-colors"
                            title="Ganze ID kopieren"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedId === session.cacheId ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={session.state === "active" ? "success" : "default"}
                            size="sm"
                            className="flex items-center gap-1"
                          >
                            {session.state === "active" && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            )}
                            {session.state === "active" ? "Aktiv" : "Idle"}
                          </Badge>
                          {session.cacheActive && (
                            <Badge variant="outline" size="sm" className="font-mono text-emerald-600 border-emerald-500/30">
                              CACHE
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        {session.provider ? (
                          <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-surface-3 text-text-muted">
                            {session.provider}
                          </span>
                        ) : (
                          <span className="text-text-muted text-xs">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-0.5">
                          {session.models.map((model) => (
                            <span
                              key={model}
                              className="font-mono text-xs text-text-main truncate max-w-[200px]"
                              title={model}
                            >
                              {model}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-4 text-right font-mono text-text-main">
                        {fmtTokens(session.promptTokens)}
                      </td>
                      <td className="p-4 text-right font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {session.cachedTokens > 0 ? fmtTokens(session.cachedTokens) : "—"}
                      </td>
                      <td className="p-4 text-right font-mono">
                        {rate == null ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <span className={rate > 50 ? "text-emerald-500 font-semibold" : ""}>
                            {rate.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right font-mono text-text-muted">
                        {session.requests}
                      </td>
                      <td className="p-4 text-right text-text-muted whitespace-nowrap">
                        {timeAgo(session.lastActive)}
                      </td>
                      <td className="p-4 text-right">
                        <Link
                          href={`/dashboard/cache-sessions/${session.cacheId}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-brand-500/10 text-brand-600 dark:text-brand-400 hover:bg-brand-500/20 transition-colors"
                        >
                          <span>Details</span>
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="10" className="p-8 text-center text-text-muted text-sm">
                    {searchQuery
                      ? "Keine Sessions passend zum Suchfilter gefunden."
                      : "Keine aktiven Sessions registriert — starte eine Konversation in Omni."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Info Explainer Card */}
      <Card className="p-5 bg-surface-2/40 border-border">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[24px] text-brand-500 mt-0.5">info</span>
          <div className="space-y-1.5 text-xs text-text-muted leading-relaxed">
            <h4 className="font-semibold text-text-main text-sm">Wie funktioniert die Session-Zuordnung in PiRouter?</h4>
            <p>
              • <strong>Deterministischer Fingerprint:</strong> Da CLI-Agenten wie Omni keine Session-IDs im HTTP-Body senden, hascht PiRouter die ersten beiden Nachrichten (System-Prompt + 1. User-Turn). Da diese im Gesprächsverlauf byte-identisch bleiben, werden alle Folge-Turns exakt derselben Session zugeordnet.
            </p>
            <p>
              • <strong>Aktivitäts-Status:</strong> Sessions gelten für <strong>5 Minuten</strong> nach dem letzten Request als <strong className="text-emerald-500">Aktiv</strong>, danach als <strong>Idle</strong>. Nach <strong>2 Stunden</strong> Inaktivität werden sie automatisch freigegeben (TTL).
            </p>
            <p>
              • <strong>Prompt-Cache & Sticky Pinning:</strong> Aktive Sessions bleiben auf demselben Provider-Account gepinnt, um KV-Cache-Hits bei Anthropic, OpenAI und GLM maximal auszunutzen.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
