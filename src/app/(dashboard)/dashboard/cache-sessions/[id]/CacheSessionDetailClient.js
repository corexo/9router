"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardSkeleton } from "@/shared/components";

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

export default function CacheSessionDetailClient({ id }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(5); // seconds, 0 = off

  const fetchDetail = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setIsRefreshing(true);
      try {
        const res = await fetch(`/api/usage/cache-sessions/${id}`);
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Session nicht gefunden oder abgelaufen (2h Inaktivitäts-TTL)."
              : "Fehler beim Abrufen der Session-Details."
          );
        }
        const json = await res.json();
        setSession(json.session);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [id]
  );

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (autoRefresh <= 0) return;
    const timer = setInterval(() => {
      fetchDetail(true);
    }, autoRefresh * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchDetail]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback
    }
  }

  if (loading && !session) return <CardSkeleton />;

  if (error && !session) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <Link
          href="/dashboard/cache-sessions"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text-main transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Zurück zu Cache Sessions</span>
        </Link>
        <Card padding="md" className="border-rose-500/40 bg-rose-500/5">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[24px] text-rose-500">error</span>
            <div>
              <h3 className="text-base font-semibold text-text-main">Session nicht verfügbar</h3>
              <p className="text-sm text-text-muted mt-1">{error}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const rate = hitRate(session.cachedTokens, session.promptTokens);
  const turns = session.turns || [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Back Link */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/cache-sessions"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text-main transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Zurück zu Cache Sessions</span>
        </Link>

        {/* Auto Refresh & Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-surface-2 rounded-lg p-0.5 border border-border text-xs">
            <span className="px-2 text-text-muted">Auto:</span>
            {[
              { label: "Aus", val: 0 },
              { label: "3s", val: 3 },
              { label: "5s", val: 5 },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => setAutoRefresh(opt.val)}
                className={`px-2 py-1 rounded font-medium transition-colors ${
                  autoRefresh === opt.val
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
            onClick={() => fetchDetail(false)}
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

      {/* Title & Badges Header */}
      <Card padding="md" className="bg-surface-2/40 border-border">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold font-mono text-text-main tracking-tight">
                Session {session.cacheId}
              </h1>
              <button
                onClick={copyId}
                className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors"
                title="ID kopieren"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {copied ? "check" : "content_copy"}
                </span>
              </button>
              <Badge
                variant={session.state === "active" ? "success" : "default"}
                size="sm"
                className="flex items-center gap-1.5"
              >
                {session.state === "active" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
                {session.state === "active" ? "Aktiv (< 5m)" : "Idle"}
              </Badge>
              {session.cacheActive && (
                <Badge variant="outline" size="sm" className="font-mono text-emerald-600 border-emerald-500/30">
                  CACHE AKTIV
                </Badge>
              )}
            </div>
            <p className="text-xs sm:text-sm text-text-muted mt-1.5">
              Erstellt: {new Date(session.createdAt).toLocaleTimeString()} ({timeAgo(session.createdAt)}) · Zuletzt aktiv: {timeAgo(session.lastActive)}
            </p>
          </div>

          {session.stickyModel && (
            <div className="flex flex-col items-start sm:items-end">
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Gepinntes Sticky-Modell
              </span>
              <span className="mt-1 px-3 py-1 rounded-full font-mono text-xs font-semibold bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20">
                {session.stickyModel}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-text-muted text-xs font-medium uppercase tracking-wider">Prompt Tokens</span>
          <div className="mt-2 text-2xl font-bold font-mono text-text-main">
            {fmtTokens(session.promptTokens)}
          </div>
          <span className="mt-1 text-xs text-text-muted">Akkumulierter Session-Input</span>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <span className="text-text-muted text-xs font-medium uppercase tracking-wider">Gecachte Tokens</span>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
            {fmtTokens(session.cachedTokens)}
          </div>
          <span className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Upstream KV-Cache Treffer</span>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <span className="text-text-muted text-xs font-medium uppercase tracking-wider">Cache Hit-Rate</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-text-main">
              {rate == null ? "—" : `${rate.toFixed(1)}%`}
            </span>
          </div>
          {rate != null && (
            <div className="mt-2 w-full bg-surface-3 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${rate}%` }}
              />
            </div>
          )}
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <span className="text-text-muted text-xs font-medium uppercase tracking-wider">Anfragen (Turns)</span>
          <div className="mt-2 text-2xl font-bold font-mono text-text-main">{session.requests}</div>
          <span className="mt-1 text-xs text-text-muted">Turns dieser Konversation</span>
        </Card>
      </div>

      {/* Session Metadata & Provider Details */}
      <Card padding="md" className="border-border">
        <h3 className="text-sm font-bold text-text-main uppercase tracking-wider mb-4">
          Session-Konfiguration &amp; Provider
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-surface-2 rounded-lg border border-border">
            <span className="text-xs text-text-muted block mb-1.5">Verwendete Modelle:</span>
            <div className="flex flex-wrap gap-1.5">
              {session.models.map((m) => (
                <span
                  key={m}
                  className={`px-2.5 py-1 rounded font-mono text-xs font-semibold ${
                    m === session.stickyModel
                      ? "bg-brand-500/15 text-brand-600 dark:text-brand-400 border border-brand-500/30"
                      : "bg-surface-3 text-text-main border border-border"
                  }`}
                >
                  {m} {m === session.stickyModel && "(aktuell)"}
                </span>
              ))}
            </div>
          </div>

          <div className="p-3 bg-surface-2 rounded-lg border border-border">
            <span className="text-xs text-text-muted block mb-1.5">Provider:</span>
            <div className="flex flex-wrap gap-1.5">
              {session.providers.map((p) => (
                <span
                  key={p}
                  className="px-2.5 py-1 rounded font-mono text-xs font-semibold bg-surface-3 text-text-main border border-border"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Turns Timeline Table */}
      <Card padding="none" className="overflow-hidden border-border">
        <div className="p-4 border-b border-border bg-surface-2/50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-text-main uppercase tracking-wider">
              Turn-Historie ({turns.length} erfasst)
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Letzte Anfragen dieser Omni-Session mit Modell- und Cache-Verlauf
            </p>
          </div>
          <Link href="/dashboard/flow">
            <Button variant="ghost" size="sm" className="flex items-center gap-1 text-xs">
              <span className="material-symbols-outlined text-[16px]">route</span>
              <span>Im Request Flow ansehen</span>
            </Button>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/30 text-xs font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-3.5">#</th>
                <th className="p-3.5">Zeitpunkt</th>
                <th className="p-3.5">Modell</th>
                <th className="p-3.5">Provider</th>
                <th className="p-3.5 text-right">Prompt-Tokens</th>
                <th className="p-3.5 text-right text-emerald-600 dark:text-emerald-400">Gecacht</th>
                <th className="p-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {turns.length > 0 ? (
                turns.map((t, idx) => (
                  <tr key={idx} className="hover:bg-surface-2/40 transition-colors">
                    <td className="p-3.5 font-mono text-xs text-text-muted">
                      {turns.length - idx}
                    </td>
                    <td className="p-3.5 text-xs text-text-muted whitespace-nowrap">
                      {new Date(t.timestamp).toLocaleTimeString()} ({timeAgo(t.timestamp)})
                    </td>
                    <td className="p-3.5 font-mono text-xs text-text-main font-semibold">
                      {t.model || "—"}
                    </td>
                    <td className="p-3.5 font-mono text-xs text-text-muted">
                      {t.provider || "—"}
                    </td>
                    <td className="p-3.5 text-right font-mono text-xs text-text-main">
                      {fmtTokens(t.promptTokens)}
                    </td>
                    <td className="p-3.5 text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {t.cachedTokens > 0 ? fmtTokens(t.cachedTokens) : "—"}
                    </td>
                    <td className="p-3.5 text-right">
                      {t.cacheActive || t.cachedTokens > 0 ? (
                        <Badge variant="outline" size="sm" className="font-mono text-emerald-600 border-emerald-500/30">
                          CACHE HIT
                        </Badge>
                      ) : (
                        <span className="text-xs text-text-muted font-mono">LIVE</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-text-muted text-sm">
                    Noch keine Turn-Details erfasst. Neue Anfragen dieser Session werden hier chronologisch aufgeführt.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
