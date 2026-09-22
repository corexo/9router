"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { Badge, Card } from "@/shared/components";
import {
  parseQuotaData,
  getRemainingPercentage,
  formatResetTime,
  getConnectionLabel,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";

const QUOTA_CACHE_STORAGE_KEY = "cockpit_compact_quota_cache";

export default function CompactQuotaTracker() {
  const [connections, setConnections] = useState([]);
  const [quotasByConn, setQuotasByConn] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState(new Set()); // per-account refresh
  const [filterMode, setFilterMode] = useState("all"); // "all" | "low"
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "table"
  const [selectedProvider, setSelectedProvider] = useState("all");

  // Load cached quota data on mount for instant rendering
  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(QUOTA_CACHE_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.quotas && Object.keys(parsed.quotas).length > 0) {
          setQuotasByConn(parsed.quotas);
        }
      }
    } catch {}
  }, []);

  // Fetch connections and quotas
  const fetchAllQuotas = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch("/api/providers/client?pageSize=500&sort=priority", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch connections");
      const data = await res.json();
      const allConns = data.connections || [];

      // Only take active connections or those with potential quota support
      const activeConns = allConns.filter((c) => c.isActive !== false);
      setConnections(activeConns);

      // Fetch usage/quota for each connection in parallel
      const quotaResults = {};
      await Promise.all(
        activeConns.map(async (conn) => {
          try {
            const qr = await fetch(`/api/usage/${conn.id}${force ? "?force=1" : ""}`, {
              cache: "no-store",
            });
            if (!qr.ok) return;
            const rawJson = await qr.json();
            const normalized = parseQuotaData(conn.provider, rawJson);
            if (normalized && normalized.length > 0) {
              quotaResults[conn.id] = {
                quotas: normalized,
                raw: rawJson,
                updatedAt: Date.now(),
              };
            }
          } catch (e) {
            // fail-open per account
          }
        })
      );

      setQuotasByConn((prev) => {
        const updated = { ...prev, ...quotaResults };
        try {
          window.localStorage.setItem(
            QUOTA_CACHE_STORAGE_KEY,
            JSON.stringify({ quotas: updated, timestamp: Date.now() })
          );
        } catch {}
        return updated;
      });
    } catch (err) {
      console.error("[CompactQuotaTracker] Error loading quotas:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh a single connection by fetching live quota from the provider
  const refreshSingleAccount = useCallback(async (conn) => {
    setRefreshingIds((prev) => new Set([...prev, conn.id]));
    try {
      const qr = await fetch(`/api/usage/${conn.id}?force=1`, { cache: "no-store" });
      if (!qr.ok) return;
      const rawJson = await qr.json();
      const normalized = parseQuotaData(conn.provider, rawJson);
      if (normalized && normalized.length > 0) {
        setQuotasByConn((prev) => {
          const updated = {
            ...prev,
            [conn.id]: { quotas: normalized, raw: rawJson, updatedAt: Date.now() },
          };
          try {
            window.localStorage.setItem(
              QUOTA_CACHE_STORAGE_KEY,
              JSON.stringify({ quotas: updated, timestamp: Date.now() })
            );
          } catch {}
          return updated;
        });
      }
    } catch (e) {
      console.error("[CompactQuotaTracker] Single refresh failed:", e);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(conn.id);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    fetchAllQuotas(false);
  }, [fetchAllQuotas]);

  // Transform connections with their quota entries
  const quotaAccounts = useMemo(() => {
    const list = [];
    for (const conn of connections) {
      const quotaInfo = quotasByConn[conn.id];
      if (!quotaInfo || !quotaInfo.quotas || quotaInfo.quotas.length === 0) continue;

      const quotas = quotaInfo.quotas.map((q) => {
        const pct = getRemainingPercentage(q);
        const resetCountdown = formatResetTime(q.resetAt);
        return {
          name: q.name,
          remainingPct: pct,
          used: q.used,
          total: q.total,
          resetAt: q.resetAt,
          resetCountdown,
        };
      });

      // Find lowest remaining quota
      const minPct = Math.min(...quotas.map((q) => q.remainingPct));
      const hasLowQuota = minPct < 30;

      list.push({
        id: conn.id,
        conn, // raw connection object — needed for single-account refresh
        name: getConnectionLabel(conn) || conn.name || conn.id,
        provider: conn.provider,
        authType: conn.authType,
        isActive: conn.isActive !== false,
        quotas,
        minPct,
        hasLowQuota,
      });
    }

    return list.sort((a, b) => a.minPct - b.minPct);
  }, [connections, quotasByConn]);

  // Unique providers list
  const availableProviders = useMemo(() => {
    const set = new Set(quotaAccounts.map((a) => a.provider));
    return Array.from(set);
  }, [quotaAccounts]);

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    return quotaAccounts.filter((account) => {
      if (filterMode === "low" && !account.hasLowQuota) return false;
      if (selectedProvider !== "all" && account.provider !== selectedProvider) return false;
      return true;
    });
  }, [quotaAccounts, filterMode, selectedProvider]);

  const lowQuotaCount = useMemo(() => {
    return quotaAccounts.filter((a) => a.hasLowQuota).length;
  }, [quotaAccounts]);

  return (
    <Card padding="md" className="flex flex-col border-border/80">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <span className="material-symbols-outlined text-[20px]">speed</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-text-main tracking-tight">
                Quota Tracker &amp; Account-Limits
              </h2>
              <Badge variant="outline" size="sm" className="font-mono text-[11px]">
                {quotaAccounts.length} {quotaAccounts.length === 1 ? "Account" : "Accounts"}
              </Badge>
              {lowQuotaCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                  {lowQuotaCount} knapp (&lt;30%)
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted">
              Echtzeit-Überwachung der 5h-Windows, Wochen-Limits und Ratenbegrenzungen
            </p>
          </div>
        </div>

        {/* Controls: Filter & Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter Pills */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border text-xs">
            <button
              onClick={() => setFilterMode("all")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filterMode === "all"
                  ? "bg-surface text-text-main shadow-xs"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Alle ({quotaAccounts.length})
            </button>
            <button
              onClick={() => setFilterMode("low")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filterMode === "low"
                  ? "bg-surface text-rose-600 dark:text-rose-400 shadow-xs"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Knapp ({lowQuotaCount})
            </button>
          </div>

          {/* Provider Filter (if multiple) */}
          {availableProviders.length > 1 && (
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="text-xs rounded-lg bg-surface border border-border px-2 py-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">Alle Provider</option>
              {availableProviders.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}

          {/* View mode toggle: Grid vs Table */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border text-xs">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1 rounded-md transition-colors ${
                viewMode === "grid"
                  ? "bg-surface text-text-main shadow-xs"
                  : "text-text-muted hover:text-text-main"
              }`}
              title="Kompakt-Kacheln"
            >
              <span className="material-symbols-outlined text-[16px]">grid_view</span>
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-1 rounded-md transition-colors ${
                viewMode === "table"
                  ? "bg-surface text-text-main shadow-xs"
                  : "text-text-muted hover:text-text-main"
              }`}
              title="Dichte Zeilen"
            >
              <span className="material-symbols-outlined text-[16px]">view_list</span>
            </button>
          </div>

          {/* Refresh button */}
          <button
            onClick={() => fetchAllQuotas(true)}
            disabled={refreshing}
            className="p-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-text-main transition-colors disabled:opacity-50"
            title="Quotas sofort neu abrufen"
          >
            <span className={`material-symbols-outlined text-[16px] ${refreshing ? "animate-spin text-primary" : ""}`}>
              refresh
            </span>
          </button>

          {/* Link to Full Quota Page */}
          <a
            href="/dashboard/usage?tab=quota"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline ml-1"
          >
            <span>Vollansicht</span>
            <span className="material-symbols-outlined text-[13px]">open_in_new</span>
          </a>
        </div>
      </div>

      {/* Content Area */}
      {loading && quotaAccounts.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 py-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="p-3 rounded-xl border border-border/60 bg-surface-2/30 animate-pulse flex flex-col gap-2"
            >
              <div className="h-4 bg-surface-3 rounded w-2/3" />
              <div className="h-2 bg-surface-3 rounded w-full mt-2" />
              <div className="h-2 bg-surface-3 rounded w-4/5" />
            </div>
          ))}
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-xs">
          {filterMode === "low"
            ? "Keine Accounts mit knappem Limit gefunden. Alle Quotas im grünen Bereich!"
            : "Keine aktiven Quota-Accounts gefunden. Unterstützt werden z.B. Claude, Codex, Gemini, GitHub."}
        </div>
      ) : viewMode === "grid" ? (
        /* COMPACT GRID VIEW (High-Density Cards) */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredAccounts.map((acc) => (
            <div
              key={acc.id}
              className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                acc.hasLowQuota
                  ? "border-rose-500/40 bg-rose-500/5 hover:border-rose-500/60"
                  : "border-border/60 bg-surface-2/40 hover:border-border"
              }`}
            >
              <div>
                {/* Account Card Header */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ProviderIcon
                      providerId={acc.provider}
                      size={18}
                      className="size-4.5 rounded object-contain shrink-0"
                      fallbackText={acc.provider.slice(0, 2).toUpperCase()}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-text-main truncate" title={acc.name}>
                        {acc.name}
                      </div>
                      <div className="text-[10px] text-text-muted uppercase font-mono tracking-wider">
                        {acc.provider}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => refreshSingleAccount(acc.conn)}
                      disabled={refreshingIds.has(acc.id) || refreshing}
                      className="p-0.5 rounded text-text-muted hover:text-primary transition-colors disabled:opacity-40"
                      title="Quota direkt vom Anbieter abrufen"
                    >
                      <span
                        className={`material-symbols-outlined text-[13px] ${
                          refreshingIds.has(acc.id) ? "animate-spin text-primary" : ""
                        }`}
                      >
                        refresh
                      </span>
                    </button>
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        acc.isActive ? "bg-emerald-500" : "bg-slate-400"
                      }`}
                      title={acc.isActive ? "Aktiv" : "Pausiert"}
                    />
                  </div>
                </div>

                {/* Quota Limits List */}
                <div className="space-y-2 mt-2">
                  {acc.quotas.map((q, idx) => {
                    const pct = q.remainingPct;
                    const isDepleted = pct <= 5;
                    const isLow = pct < 30;
                    const barColor = isLow
                      ? "bg-rose-500"
                      : pct < 70
                      ? "bg-amber-500"
                      : "bg-emerald-500";
                    const textColor = isLow
                      ? "text-rose-600 dark:text-rose-400 font-bold"
                      : pct < 70
                      ? "text-amber-600 dark:text-amber-400 font-medium"
                      : "text-emerald-600 dark:text-emerald-400 font-medium";

                    return (
                      <div key={idx} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted truncate max-w-[120px]" title={q.name}>
                            {q.name}
                          </span>
                          <div className="flex items-center gap-1.5 font-mono">
                            <span className={textColor}>
                              {pct}% frei
                            </span>
                          </div>
                        </div>

                        {/* Thin Progress Bar */}
                        <div className="w-full bg-surface-3 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                          />
                        </div>

                        {/* Reset countdown if available */}
                        {q.resetCountdown && q.resetCountdown !== "-" && (
                          <div className="flex items-center justify-end text-[10px] text-text-muted font-mono">
                            <span>Reset in {q.resetCountdown}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* COMPACT TABLE VIEW (Ultra-Dense Rows) */
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2/40 font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-2.5">Account</th>
                <th className="p-2.5">Provider</th>
                <th className="p-2.5">Limits &amp; Verbleibende Quotas</th>
                <th className="p-2.5 text-center">Niedrigste Quota</th>
                <th className="p-2.5 text-right">Nächster Reset</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredAccounts.map((acc) => {
                const earliestReset = acc.quotas
                  .map((q) => q.resetCountdown)
                  .find((c) => c && c !== "-");

                return (
                  <tr key={acc.id} className="hover:bg-surface-2/40 transition-colors">
                    <td className="p-2.5 font-medium text-text-main truncate max-w-[180px]">
                      <div className="flex items-center gap-2">
                        <ProviderIcon
                          providerId={acc.provider}
                          size={16}
                          className="size-4 rounded object-contain shrink-0"
                          fallbackText={acc.provider.slice(0, 2).toUpperCase()}
                        />
                        <span className="truncate">{acc.name}</span>
                        <button
                          onClick={() => refreshSingleAccount(acc.conn)}
                          disabled={refreshingIds.has(acc.id) || refreshing}
                          className="ml-auto p-0.5 rounded text-text-muted hover:text-primary transition-colors disabled:opacity-40 shrink-0"
                          title="Quota direkt vom Anbieter abrufen"
                        >
                          <span
                            className={`material-symbols-outlined text-[12px] ${
                              refreshingIds.has(acc.id) ? "animate-spin text-primary" : ""
                            }`}
                          >
                            refresh
                          </span>
                        </button>
                      </div>
                    </td>
                    <td className="p-2.5 font-mono text-text-muted uppercase text-[11px]">
                      {acc.provider}
                    </td>
                    <td className="p-2.5">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {acc.quotas.map((q, i) => {
                          const pct = q.remainingPct;
                          const isLow = pct < 30;
                          return (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border ${
                                isLow
                                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30"
                                  : pct < 70
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                                  : "bg-surface-2 text-text-main border-border"
                              }`}
                              title={`${q.name}: ${pct}% verbleibend`}
                            >
                              <span className="text-text-muted">{q.name}:</span>
                              <span className="font-bold">{pct}%</span>
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="p-2.5 text-center font-mono font-bold">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] ${
                          acc.minPct < 30
                            ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                            : acc.minPct < 70
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {acc.minPct}%
                      </span>
                    </td>
                    <td className="p-2.5 text-right font-mono text-text-muted">
                      {earliestReset ? `in ${earliestReset}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
