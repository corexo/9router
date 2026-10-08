"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { PROVIDER_DISPLAY } from "@/shared/constants/providersDisplay";
import { calculatePercentage, parseQuotaData } from "../usage/components/ProviderLimits/utils";
import { countdown } from "@/shared/utils/quotaCountdown";

function remaining(quota) {
  if (quota.remaining !== undefined) return Math.max(0, Math.round(quota.remaining));
  if (quota.remainingPercentage !== undefined) return Math.max(0, Math.round(quota.remainingPercentage));
  return quota.total > 0 ? calculatePercentage(quota.used, quota.total) : null;
}

export default function AccountQuotasClient() {
  const [accounts, setAccounts] = useState([]);
  const [quotas, setQuotas] = useState({});
  const [errors, setErrors] = useState({});
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accountBalanceEnabled, setAccountBalanceEnabled] = useState(false);
  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const [settingsResponse, response] = await Promise.all([
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/providers/client?pageSize=500&sort=priority"),
      ]);
      const settings = settingsResponse.ok ? await settingsResponse.json().catch(() => ({})) : {};
      const balanceEnabled = settings.accountBalanceEnabled === true;
      setAccountBalanceEnabled(balanceEnabled);
      if (!response.ok) throw new Error(`Accounts konnten nicht geladen werden (HTTP ${response.status})`);
      const data = await response.json();
      const eligible = (data.connections || []).filter((account) => account.isActive !== false && (account.authType === "oauth" || account.authType === "apikey" || account.authType === "api_key"));
      setAccounts(eligible);
      if (!balanceEnabled) return;
      const results = await Promise.all(eligible.map(async (account) => {
        try {
          const usage = await fetch(`/api/usage/${encodeURIComponent(account.id)}${force ? "?force=1" : ""}`);
          const payload = await usage.json().catch(() => ({}));
          if (!usage.ok) throw new Error(payload.error || `HTTP ${usage.status}`);
          if (payload.message === "Usage not available for this connection") return [account.id, { quotas: [], message: payload.message }];
          return [account.id, { quotas: parseQuotaData(account.provider, payload) }];
        } catch (error) {
          return [account.id, { error: error.message }];
        }
      }));
      setQuotas(Object.fromEntries(results.filter(([, result]) => !result.error)));
      setErrors(Object.fromEntries(results.filter(([, result]) => result.error).map(([id, result]) => [id, result.error])));
    } catch (error) {
      setErrors({ page: error.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const start = setTimeout(() => { setNow(Date.now()); load(); }, 0);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => { clearTimeout(start); clearInterval(timer); };
  }, [load]);

  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-text-primary">Account-Quotas</h1><p className="mt-1 text-sm text-text-muted">Aktueller Quota-Stand, Reset-Fenster und OAuth-Session-Ablauf je Account.</p></div><button type="button" disabled={!accountBalanceEnabled || refreshing || loading} onClick={() => load(true)} className="rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" aria-busy={refreshing}>{refreshing ? "Aktualisiere…" : "Quotas aktualisieren"}</button></header>
    {!accountBalanceEnabled && !loading && <Card className="border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300" role="status">Account Balance deaktiviert. Quota-Abfragen und Reset-Aktionen sind pausiert; gespeicherte Historie bleibt erhalten.</Card>}{errors.page && <Card className="border-red-500/40 p-4 text-sm text-red-600" role="alert">{errors.page}</Card>}
    {loading ? <Card className="p-6 text-sm text-text-muted" aria-live="polite">Accounts und Quotas werden geladen…</Card> : accounts.length === 0 ? <Card className="p-8 text-center text-sm text-text-muted">Keine quota-fähigen Provider-Accounts gefunden.</Card> : <div className="grid gap-4 xl:grid-cols-2">{accounts.map((account) => {
      const rows = quotas[account.id]?.quotas || [];
      const providerName = PROVIDER_DISPLAY[account.provider]?.name || account.provider;
      return <Card key={account.id} className="space-y-4 p-4">
        <div className="flex items-center gap-3"><ProviderIcon providerId={account.provider} alt={providerName} size={36} className="rounded-lg" fallbackText={providerName.slice(0, 2).toUpperCase()} /><div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-text-primary">{account.name || account.email || account.displayName || providerName}</h2><p className="text-xs text-text-muted">{providerName} · {account.authType === "oauth" ? "OAuth" : "API-Key"}</p></div><span className={`rounded-full px-2 py-1 text-xs ${account.isActive === false ? "bg-surface-2 text-text-muted" : "bg-primary/10 text-primary"}`}>{account.isActive === false ? "Inaktiv" : "Aktiv"}</span></div>
        <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-text-muted">OAuth Session Time</p><p className="mt-1 text-sm font-medium text-text-primary">{account.authType !== "oauth" ? "Keine OAuth-Session" : countdown(account.expiresAt, now)}</p><p className="mt-1 text-xs text-text-muted">{account.authType === "oauth" && account.expiresAt ? `Token-Ablauf: ${new Date(account.expiresAt).toLocaleString("de-DE")}` : "Separat vom Quota-Reset"}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-text-muted">Quota-Reset</p><p className="mt-1 text-sm font-medium text-text-primary">{rows.some((quota) => quota.resetAt) ? `${rows.filter((quota) => quota.resetAt).length} Zeitfenster verfügbar` : "Kein Reset-Zeitpunkt gemeldet"}</p><p className="mt-1 text-xs text-text-muted">{rows.length} Quota-Einträge erfasst</p></div></div>
        {errors[account.id] ? <p className="text-sm text-amber-600" role="status">Quota nicht verfügbar: {errors[account.id]}</p> : rows.length ? <ul className="divide-y divide-border-subtle">{rows.map((quota, index) => { const percent = remaining(quota); return <li key={`${quota.modelKey || quota.name}-${index}`} className="py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-text-primary">{quota.name}</p><p className="text-xs text-text-muted">{quota.unlimited ? "Unbegrenzt" : `${quota.used ?? 0} / ${quota.total || "∞"}${percent === null ? "" : ` · ${percent}% verfügbar`}`}</p></div><p className="shrink-0 text-right text-xs text-text-muted">{quota.resetAt ? countdown(quota.resetAt, now) : "Reset-Zeit unbekannt"}</p></div>{percent !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={`h-full rounded-full ${percent > 60 ? "bg-primary" : percent > 25 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.min(percent, 100)}%` }} /></div>}</li>; })}</ul> : <p className="py-2 text-sm text-text-muted">{quotas[account.id]?.message || (quotas[account.id] ? "Keine Quota-Daten verfügbar." : "Quota noch nicht geladen.")}</p>}
      </Card>;
    })}</div>}
  </main>;
}
