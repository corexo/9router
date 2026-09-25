"use client";

import { useCallback, useEffect, useState } from "react";
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
  if (!promptTokens) return null;
  return (cachedTokens / promptTokens) * 100;
}

export default function CacheSessionsClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Fetch only on mount and manual refresh — no polling.
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
    const timer = setTimeout(() => fetchData(), 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  async function copyId(id) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — ignore silently.
    }
  }

  if (loading && !data) return <CardSkeleton />;

  const sessions = data?.sessions || [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main tracking-tight">Cache Sessions</h1>
          <p className="text-sm text-text-muted mt-1">
            Aktive Konversationen mit opaker Cache-ID, Sticky-Modellen und Token-/Cache-Verbrauch
          </p>
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

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-xs font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-4">Cache-ID</th>
                <th className="p-4">Status</th>
                <th className="p-4">Modell(e)</th>
                <th className="p-4 text-right">Prompt-Tokens</th>
                <th className="p-4 text-right text-emerald-600 dark:text-emerald-400">Gecacht</th>
                <th className="p-4 text-right">Hit-Rate</th>
                <th className="p-4 text-right">Requests</th>
                <th className="p-4 text-right">Letzte Aktivität</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.length > 0 ? (
                sessions.map((session) => {
                  const rate = hitRate(session.cachedTokens, session.promptTokens);
                  return (
                    <tr key={session.cacheId} className="hover:bg-surface-2/40 transition-colors">
                      <td className="p-4">
                        <button
                          onClick={() => copyId(session.cacheId)}
                          className="flex items-center gap-1.5 font-mono text-xs text-text-main hover:text-text-muted"
                          title={session.cacheId}
                        >
                          <span>{session.cacheId.slice(0, 8)}…</span>
                          <span className="material-symbols-outlined text-[14px] text-text-muted">
                            {copiedId === session.cacheId ? "check" : "content_copy"}
                          </span>
                        </button>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Badge variant={session.state === "active" ? "success" : "default"} size="sm">
                            {session.state === "active" ? "Aktiv" : "Idle"}
                          </Badge>
                          {session.cacheActive && (
                            <Badge variant="outline" size="sm" className="font-mono">CACHE</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-0.5">
                          {session.models.map((model) => (
                            <span key={model} className="font-mono text-xs text-text-main truncate max-w-[220px]" title={model}>
                              {model}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-4 text-right font-mono text-text-main">{fmtTokens(session.promptTokens)}</td>
                      <td className="p-4 text-right font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {session.cachedTokens > 0 ? fmtTokens(session.cachedTokens) : "—"}
                      </td>
                      <td className="p-4 text-right font-mono">
                        {rate == null ? <span className="text-text-muted">—</span> : `${rate.toFixed(1)}%`}
                      </td>
                      <td className="p-4 text-right font-mono text-text-muted">{session.requests}</td>
                      <td className="p-4 text-right text-text-muted whitespace-nowrap">{timeAgo(session.lastActive)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-text-muted text-sm">
                    Keine aktiven Sessions — starte eine Konversation über 9Router.
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
