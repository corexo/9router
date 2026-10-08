"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { Badge, Card } from "@/shared/components";
import {
  parseQuotaData,
  getRemainingPercentage,
  formatResetTime,
  computeResetTimeProgress,
  getConnectionLabel,
  supportsResetCredits,
  getResetCreditCount,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";

const QUOTA_CACHE_STORAGE_KEY = "cockpit_compact_quota_cache";

export default function CompactQuotaTracker() {
  const [connections, setConnections] = useState([]);
  const [quotasByConn, setQuotasByConn] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const cached = window.localStorage.getItem(QUOTA_CACHE_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.quotas && Object.keys(parsed.quotas).length > 0) {
          return parsed.quotas;
        }
      }
    } catch {}
    return {};
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState(new Set()); // per-account refresh
  const [filterMode, setFilterMode] = useState("all"); // "all" | "low"
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "table"
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [resettingId, setResettingId] = useState(null);
  const [resetConfirmState, setResetConfirmState] = useState(null); // { account, resetCreditCount }
  const [resetFeedback, setResetFeedback] = useState(null); // { type: 'success'|'error', text: string }
  const [accountBalanceEnabled, setAccountBalanceEnabled] = useState(false);

  // Fetch connections and quotas
  const fetchAllQuotas = useCallback(async (force = false, allowLive = accountBalanceEnabled) => {
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
      if (!allowLive) return;

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
  }, [accountBalanceEnabled]);

  // Refresh a single connection by fetching live quota from the provider
  const refreshSingleAccount = useCallback(async (conn) => {
    if (!accountBalanceEnabled) return;
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
  }, [accountBalanceEnabled]);

  // Execute reset for an account (Codex, Claude, GLM)
  const handleExecuteReset = useCallback(async (account) => {
    if (!accountBalanceEnabled || !account || resettingId) return;
    setResettingId(account.id);
    setResetFeedback(null);
    try {
      const res = await fetch(`/api/usage/${account.id}/reset-credits`, {
        method: "POST",
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.message || result.error || "Reset fehlgeschlagen");
      }

      // Refresh single account quota directly
      await refreshSingleAccount(account.conn);
      setResetFeedback({
        type: "success",
        text: `Limit für ${account.name} (${account.provider}) erfolgreich zurückgesetzt!`,
      });
      setTimeout(() => setResetFeedback(null), 5000);
    } catch (err) {
      setResetFeedback({
        type: "error",
        text: `Fehler beim Reset für ${account.name}: ${err.message}`,
      });
      setTimeout(() => setResetFeedback(null), 6000);
    } finally {
      setResettingId(null);
      setResetConfirmState(null);
    }
  }, [accountBalanceEnabled, refreshSingleAccount, resettingId]);

  useEffect(() => {
    let ignore = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json().catch(() => ({})))
      .then(async (settings) => {
        const enabled = settings.accountBalanceEnabled === true;
        if (!ignore) setAccountBalanceEnabled(enabled);
        await fetchAllQuotas(false, enabled);
      })
      .catch(() => fetchAllQuotas(false, false));
    return () => { ignore = true; };
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
        const timeProgress = computeResetTimeProgress(q.resetAt, q.name);
        return {
          name: q.name,
          remainingPct: pct,
          used: q.used,
          total: q.total,
          resetAt: q.resetAt,
          resetCountdown,
          timeProgress,
        };
      });

      // Find lowest remaining quota
      const minPct = Math.min(...quotas.map((q) => q.remainingPct));
      const hasLowQuota = minPct < 30;
      const supportsReset = supportsResetCredits(conn.provider);
      const resetCreditCount = supportsReset ? getResetCreditCount(quotaInfo) : 0;

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
        supportsReset,
        resetCreditCount,
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

  const totalResetCredits = useMemo(() => {
    return quotaAccounts.reduce((sum, a) => sum + (a.resetCreditCount || 0), 0);
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
              {!accountBalanceEnabled && <Badge variant="outline" size="sm">Deactivated</Badge>}
              {lowQuotaCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                  {lowQuotaCount} knapp (&lt;30%)
                </span>
              )}
              {totalResetCredits > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <span className="material-symbols-outlined text-[13px]">bolt</span>
                  {totalResetCredits} Reset-Credit{totalResetCredits > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted">
              {accountBalanceEnabled
                ? "Echtzeit-Überwachung der 5h-Windows, Wochen-Limits und Ratenbegrenzungen mit Countdown-Balken"
                : "Account Balance deaktiviert: gespeicherte Kontingente werden nur angezeigt."}
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

          {/* Refresh button: active only while Account Balance is enabled */}
          {accountBalanceEnabled && <button
            onClick={() => fetchAllQuotas(true)}
            disabled={refreshing}
            className="p-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-text-main transition-colors disabled:opacity-50"
            title="Quotas sofort neu abrufen"
          >
            <span className={`material-symbols-outlined text-[16px] ${refreshing ? "animate-spin text-primary" : ""}`}>
              refresh
            </span>
          </button>}

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

      {/* Reset Feedback Notification */}
      {resetFeedback && (
        <div
          className={`mb-3 p-2.5 rounded-lg text-xs font-medium flex items-center justify-between border ${
            resetFeedback.type === "success"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
              : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">
              {resetFeedback.type === "success" ? "check_circle" : "error"}
            </span>
            <span>{resetFeedback.text}</span>
          </div>
          <button
            onClick={() => setResetFeedback(null)}
            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {filteredAccounts.map((acc) => (
            <div
              key={acc.id}
              className={`p-2.5 rounded-lg border transition-colors flex flex-col justify-between ${
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
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-text-muted uppercase font-mono tracking-wider">
                          {acc.provider}
                        </span>
                        {acc.conn?.throttlePercent > 0 && (
                          <span
                            className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 lowercase"
                            title={`${acc.conn.throttlePercent}% gedrosselt (${100 - acc.conn.throttlePercent}% Traffic)`}
                          >
                            📉 {acc.conn.throttlePercent}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {accountBalanceEnabled && <button
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
                    </button>}
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        acc.isActive ? "bg-emerald-500" : "bg-slate-400"
                      }`}
                      title={acc.isActive ? "Aktiv" : "Pausiert"}
                    />
                  </div>
                </div>

                {/* Quota Limits List */}
                <div className="space-y-1 mt-1">
                  {acc.quotas.map((q, idx) => {
                    const pct = q.remainingPct;
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
                      <div key={idx} className="grid grid-cols-[minmax(74px,0.8fr)_auto_minmax(44px,0.45fr)_minmax(98px,auto)] items-center gap-x-2 gap-y-1 px-2 py-1.5 rounded-md bg-surface-1/40 border border-border/40">
                        {/* Quota Name & Percent Available */}
                        <span className="text-[10px] text-text-main font-medium truncate" title={q.name}>{q.name}</span>
                        <span className={`text-[11px] font-mono ${textColor}`}>{pct}% frei</span>
                        {/* Quota left */}
                        <div className="w-full bg-surface-3 rounded-full h-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                          />
                        </div>

                        {/* Time Window Progress Bar (Zeit-Balken) */}
                        {q.timeProgress ? (
                          <span className="text-[10px] font-mono font-semibold text-cyan-700 dark:text-cyan-300 whitespace-nowrap text-right" title={`${q.timeProgress.totalWindowLabel}, ${q.timeProgress.percentElapsed}% abgelaufen`}>
                            {q.timeProgress.countdownText}
                          </span>
                        ) : q.resetCountdown && q.resetCountdown !== "-" ? (
                          <span className="text-[10px] font-mono text-text-muted whitespace-nowrap text-right">{q.resetCountdown}</span>
                        ) : <span /> }
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reset Credit Counter & Reset Action Button */}
              {accountBalanceEnabled && acc.supportsReset && (
                <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-amber-500">bolt</span>
                    <span className="font-mono text-text-muted">
                      {acc.resetCreditCount > 0 ? (
                        <span className="font-bold text-amber-600 dark:text-amber-400">
                          {acc.resetCreditCount} Reset{acc.resetCreditCount > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span>0 Resets</span>
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setResetConfirmState({ account: acc, resetCreditCount: acc.resetCreditCount })}
                    disabled={resettingId === acc.id}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all border shadow-2xs ${
                      acc.resetCreditCount > 0
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 active:scale-95"
                        : "border-border bg-surface-2 text-text-muted hover:text-text-main hover:bg-surface-3 active:scale-95"
                    }`}
                    title="Wöchentliches Kontingent / Rate-Limit zurücksetzen"
                  >
                    <span className={`material-symbols-outlined text-[13px] ${resettingId === acc.id ? "animate-spin" : ""}`}>
                      {resettingId === acc.id ? "progress_activity" : "restart_alt"}
                    </span>
                    <span>Reset</span>
                  </button>
                </div>
              )}
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
                <th className="p-2.5 text-right">Nächster Reset (Zeit-Balken)</th>
                <th className="p-2.5 text-center">Reset-Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredAccounts.map((acc) => {
                const earliestTimeProgress = acc.quotas
                  .map((q) => q.timeProgress)
                  .find((tp) => tp && tp.countdownText && tp.countdownText !== "-");

                const earliestResetText = acc.quotas
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
                        {accountBalanceEnabled && <button
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
                        </button>}
                      </div>
                    </td>
                    <td className="p-2.5 font-mono text-text-muted uppercase text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span>{acc.provider}</span>
                        {acc.conn?.throttlePercent > 0 && (
                          <span
                            className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 lowercase"
                            title={`${acc.conn.throttlePercent}% gedrosselt (${100 - acc.conn.throttlePercent}% Traffic)`}
                          >
                            📉 {acc.conn.throttlePercent}%
                          </span>
                        )}
                      </div>
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
                    <td className="p-2.5 text-right font-mono">
                      {earliestTimeProgress ? (
                        <div className="inline-flex flex-col items-end gap-1 min-w-[130px]">
                          <div className="flex items-center gap-1 text-[11px] text-cyan-700 dark:text-cyan-300 font-medium">
                            <span className="material-symbols-outlined text-[12px]">schedule</span>
                            <span>in {earliestTimeProgress.countdownText}</span>
                          </div>
                          {/* Horizontal Time Bar */}
                          <div
                            className="w-24 bg-surface-3 rounded-full h-1.5 overflow-hidden"
                            title={`Zeitfenster (${earliestTimeProgress.totalWindowLabel}): ${earliestTimeProgress.percentElapsed}% abgelaufen, noch ${earliestTimeProgress.countdownText}`}
                          >
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-300"
                              style={{ width: `${Math.min(100, Math.max(3, earliestTimeProgress.percentElapsed))}%` }}
                            />
                          </div>
                        </div>
                      ) : earliestResetText ? (
                        <span className="text-text-muted text-xs">in {earliestResetText}</span>
                      ) : (
                        <span className="text-text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {accountBalanceEnabled && acc.supportsReset ? (
                        <div className="inline-flex items-center justify-center gap-1.5">
                          {acc.resetCreditCount > 0 ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                              ⚡ {acc.resetCreditCount}
                            </span>
                          ) : (
                            <span className="text-[10px] text-text-muted font-mono">0</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setResetConfirmState({ account: acc, resetCreditCount: acc.resetCreditCount })}
                            disabled={resettingId === acc.id}
                            className="p-1 rounded text-text-muted hover:text-amber-500 hover:bg-surface-3 transition-colors disabled:opacity-40"
                            title="Limit zurücksetzen"
                          >
                            <span className={`material-symbols-outlined text-[14px] ${resettingId === acc.id ? "animate-spin" : ""}`}>
                              {resettingId === acc.id ? "progress_activity" : "restart_alt"}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-text-muted text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Explicit Confirmation Modal for Resetting Quota Limits */}
      {resetConfirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-black/15 bg-white shadow-2xl ring-1 ring-black/10 dark:border-white/15 dark:bg-neutral-950 dark:ring-white/10">
            {/* Modal Header with Warning Icon */}
            <div className="flex items-start justify-between gap-3 border-b border-black/10 bg-amber-500/10 px-5 py-4 dark:border-white/10 dark:bg-amber-500/15">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined text-[24px]">warning</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-text-main">
                    Kontingent-Reset bestätigen
                  </h3>
                  <p className="text-xs text-text-muted">
                    Soll das Kontingent für diesen Account wirklich zurückgesetzt werden?
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!resettingId) setResetConfirmState(null);
                }}
                disabled={Boolean(resettingId)}
                className="p-1 rounded-lg text-text-muted hover:bg-black/5 hover:text-text-main transition-colors dark:hover:bg-white/5 disabled:opacity-40"
                aria-label="Modal schließen"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* Account Card Box */}
              <div className="p-3 rounded-xl border border-border/70 bg-surface-2/60 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ProviderIcon
                    providerId={resetConfirmState.account?.provider}
                    size={22}
                    className="size-5.5 rounded object-contain shrink-0"
                    fallbackText={resetConfirmState.account?.provider?.slice(0, 2).toUpperCase()}
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-text-main truncate">
                      {resetConfirmState.account?.name}
                    </div>
                    <div className="text-[10px] text-text-muted uppercase font-mono">
                      {resetConfirmState.account?.provider}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {resetConfirmState.resetCreditCount > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-mono bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                      ⚡ {resetConfirmState.resetCreditCount} Credit{resetConfirmState.resetCreditCount > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="text-[11px] text-text-muted font-mono">0 Credits</span>
                  )}
                </div>
              </div>

              {/* Warning Text Details */}
              <div className="text-xs text-text-muted space-y-2 leading-relaxed">
                {resetConfirmState.account?.provider === "codex" ? (
                  resetConfirmState.resetCreditCount > 0 ? (
                    <div className="text-amber-700 dark:text-amber-300 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 space-y-1">
                      <p className="font-semibold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">bolt</span>
                        1 Codex Reset-Credit wird eingelöst
                      </p>
                      <p className="text-[11px] text-text-muted">
                        Dieser Vorgang setzt das wöchentliche und 5h-Limit bei OpenAI sofort zurück. Dies kann nicht rückgängig gemacht werden!
                      </p>
                    </div>
                  ) : (
                    <div className="text-rose-600 dark:text-rose-400 bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 space-y-1">
                      <p className="font-semibold">Keine Reset-Credits verfügbar</p>
                      <p className="text-[11px] text-text-muted">
                        PiRouter hebt lokale Modell-Locks auf und erzwingt einen frischen Quota-Abruf.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="text-amber-700 dark:text-amber-300 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                      Modell-Locks und Cache werden zurückgesetzt
                    </p>
                    <p className="text-[11px] text-text-muted">
                      Alle aktiven Sperren für {resetConfirmState.account?.name} auf PiRouter werden sofort aufgehoben und die Quotas neu abgefragt.
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-text-muted/90 pt-1">
                  Möchtest du fortfahren?
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 border-t border-border px-5 py-3.5 bg-surface-2/40">
              <button
                type="button"
                onClick={() => setResetConfirmState(null)}
                disabled={Boolean(resettingId)}
                className="px-3.5 py-1.5 rounded-xl border border-border text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors disabled:opacity-40"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => handleExecuteReset(resetConfirmState.account)}
                disabled={Boolean(resettingId)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 active:scale-95 transition-all shadow-xs disabled:opacity-60"
              >
                {resettingId ? (
                  <>
                    <span className="material-symbols-outlined text-[15px] animate-spin">
                      progress_activity
                    </span>
                    <span>Wird zurückgesetzt...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[15px]">
                      restart_alt
                    </span>
                    <span>Jetzt zurücksetzen</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
