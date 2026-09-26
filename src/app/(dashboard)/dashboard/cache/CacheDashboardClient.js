"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Chart from "chart.js/auto";
import { Card, Button, Badge, SegmentedControl, CardSkeleton } from "@/shared/components";
import { usePersistentState } from "@/shared/hooks";

const PERIODS = [
  { value: "today", label: "Heute" },
  { value: "24h", label: "24 Std" },
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "60d", label: "60 Tage" },
];

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
  const days = Math.floor(hours / 24);
  return `vor ${days}d`;
}

export default function CacheDashboardClient() {
  const [period, setPeriod] = usePersistentState("9router_period", "7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = usePersistentState("9router_cache_auto_refresh", true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const timelineCanvasRef = useRef(null);
  const timelineChartInstance = useRef(null);

  const providerCanvasRef = useRef(null);
  const providerChartInstance = useRef(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setIsRefreshing(true);
    try {
      const res = await fetch(`/api/usage/cache?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("[CacheDashboard] Error loading cache stats:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh interval (every 10s if enabled)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchData(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  // Render / update Chart.js instances
  useEffect(() => {
    if (!data || loading) return;

    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const textColor = isDark ? "#94A3B8" : "#64748B";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)";
    const tooltipBg = isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.98)";
    const tooltipText = isDark ? "#F8FAFC" : "#0F172A";
    const tooltipBorder = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";

    // 1. Timeline Chart (Stacked Bar + Hit Rate Line)
    if (timelineCanvasRef.current && data.timeSeries?.length > 0) {
      if (timelineChartInstance.current) {
        timelineChartInstance.current.destroy();
      }

      const labels = data.timeSeries.map((t) => t.label);
      const cachedTokens = data.timeSeries.map((t) => t.cachedTokens);
      const uncachedTokens = data.timeSeries.map((t) => t.uncachedTokens);
      const hitRates = data.timeSeries.map((t) => t.hitRate);

      const ctx = timelineCanvasRef.current.getContext("2d");
      timelineChartInstance.current = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              type: "line",
              label: "Cache Hit-Rate (%)",
              data: hitRates,
              borderColor: "#F59E0B",
              backgroundColor: "#F59E0B",
              borderWidth: 2.5,
              pointBackgroundColor: "#F59E0B",
              pointBorderColor: "#FFFFFF",
              pointBorderWidth: 1.5,
              pointRadius: 4,
              pointHoverRadius: 6,
              yAxisID: "yRate",
              tension: 0.3,
              order: 1,
            },
            {
              type: "bar",
              label: "Gecachte Tokens",
              data: cachedTokens,
              backgroundColor: "rgba(16, 185, 129, 0.85)",
              hoverBackgroundColor: "rgba(16, 185, 129, 1)",
              borderRadius: 4,
              stack: "tokens",
              yAxisID: "yTokens",
              order: 2,
            },
            {
              type: "bar",
              label: "Neue / Ungecachte Tokens",
              data: uncachedTokens,
              backgroundColor: isDark ? "rgba(99, 102, 241, 0.45)" : "rgba(99, 102, 241, 0.6)",
              hoverBackgroundColor: "rgba(99, 102, 241, 0.85)",
              borderRadius: 4,
              stack: "tokens",
              yAxisID: "yTokens",
              order: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: "index",
            intersect: false,
          },
          plugins: {
            legend: {
              position: "top",
              labels: {
                color: textColor,
                usePointStyle: true,
                font: { size: 12 },
              },
            },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: tooltipText,
              bodyColor: tooltipText,
              borderColor: tooltipBorder,
              borderWidth: 1,
              padding: 12,
              boxPadding: 6,
              usePointStyle: true,
              callbacks: {
                label(context) {
                  const label = context.dataset.label || "";
                  const val = context.parsed.y;
                  if (context.dataset.yAxisID === "yRate") {
                    return ` ${label}: ${val.toFixed(1)}%`;
                  }
                  return ` ${label}: ${fmtTokens(val)} Tokens (${Number(val).toLocaleString()})`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: textColor, font: { size: 11 } },
            },
            yTokens: {
              type: "linear",
              position: "left",
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                callback(val) {
                  return fmtTokens(val);
                },
                font: { size: 11 },
              },
              title: {
                display: true,
                text: "Tokens",
                color: textColor,
              },
            },
            yRate: {
              type: "linear",
              position: "right",
              min: 0,
              max: 100,
              grid: { drawOnChartArea: false },
              ticks: {
                color: "#F59E0B",
                callback(val) {
                  return val + "%";
                },
                font: { size: 11 },
              },
              title: {
                display: true,
                text: "Hit Rate (%)",
                color: "#F59E0B",
              },
            },
          },
        },
      });
    }

    // 2. Provider Doughnut Chart
    if (providerCanvasRef.current && data.byProvider?.length > 0) {
      if (providerChartInstance.current) {
        providerChartInstance.current.destroy();
      }

      const activeProviders = data.byProvider.filter((p) => p.cachedTokens > 0);
      const labels = activeProviders.map((p) => p.name);
      const cachedData = activeProviders.map((p) => p.cachedTokens);
      const colors = activeProviders.map((p) => p.color);

      const ctxP = providerCanvasRef.current.getContext("2d");
      providerChartInstance.current = new Chart(ctxP, {
        type: "doughnut",
        data: {
          labels,
          datasets: [
            {
              data: cachedData,
              backgroundColor: colors,
              borderWidth: 2,
              borderColor: isDark ? "#0F172A" : "#FFFFFF",
              hoverOffset: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: textColor,
                usePointStyle: true,
                font: { size: 11 },
              },
            },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: tooltipText,
              bodyColor: tooltipText,
              borderColor: tooltipBorder,
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label(context) {
                  const pName = context.label || "";
                  const val = context.raw || 0;
                  const total = cachedData.reduce((a, b) => a + b, 0);
                  const share = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                  return ` ${pName}: ${fmtTokens(val)} (${share}% des Caches)`;
                },
              },
            },
          },
          cutout: "68%",
        },
      });
    }

    return () => {
      if (timelineChartInstance.current) timelineChartInstance.current.destroy();
      if (providerChartInstance.current) providerChartInstance.current.destroy();
    };
  }, [data, loading]);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const summary = data?.summary || {
    totalPromptTokens: 0,
    totalCachedTokens: 0,
    overallHitRate: 0,
    totalRequests: 0,
    cachedRequests: 0,
    estimatedSavingsUsd: 0,
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-main tracking-tight">Prompt Cache Effizienz</h1>
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" title="Live Aktiv" />
          </div>
          <p className="text-sm text-text-muted mt-1">
            Messung und Einsparungen durch Prompt-Caching für Claude, Z.ai (GLM), ChatGPT (Codex) &amp; Gemini
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:self-auto">
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
          />

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

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              autoRefresh
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-border bg-surface text-text-muted hover:text-text-main"
            }`}
            title="Alle 10 Sekunden automatisch aktualisieren"
          >
            <span className="material-symbols-outlined text-[14px]">
              {autoRefresh ? "sync" : "sync_disabled"}
            </span>
            <span>Live 10s</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Hit Rate */}
        <Card padding="md" className="relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Cache Hit-Rate
            </span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <span className="material-symbols-outlined text-[20px]">speed</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-text-main">
              {summary.overallHitRate}%
            </span>
            <Badge
              variant={summary.overallHitRate >= 50 ? "success" : summary.overallHitRate >= 25 ? "warning" : "default"}
              size="sm"
            >
              {summary.overallHitRate >= 50 ? "Hervorragend" : summary.overallHitRate >= 25 ? "Gut" : "Aktiv"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {fmtTokens(summary.totalCachedTokens)} von {fmtTokens(summary.totalPromptTokens)} Prompt-Tokens
          </p>
          <div className="mt-3 w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, summary.overallHitRate))}%` }}
            />
          </div>
        </Card>

        {/* Tokens Gecached */}
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Gecachte Tokens
            </span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <span className="material-symbols-outlined text-[20px]">memory</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {fmtTokens(summary.totalCachedTokens)}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Prompt-Tokens aus Provider-Cache wiederverwendet
          </p>
          <div className="mt-3 text-xs font-mono text-text-muted truncate">
            {summary.totalCachedTokens.toLocaleString()} Tokens exakt
          </div>
        </Card>

        {/* Geschätzte Ersparnis */}
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Geschätzte Ersparnis
            </span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <span className="material-symbols-outlined text-[20px]">savings</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-bold font-mono text-amber-600 dark:text-amber-400">
              ${summary.estimatedSavingsUsd}
            </span>
            <span className="text-xs text-text-muted font-normal">USD</span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            ca. 90% Rabatt auf gecachte Tokens
          </p>
          <div className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            <span>Upstream-Kosten drastisch reduziert</span>
          </div>
        </Card>

        {/* Gecachte Requests */}
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Gecachte Requests
            </span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <span className="material-symbols-outlined text-[20px]">cached</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-bold font-mono text-text-main">
              {summary.cachedRequests.toLocaleString()}
            </span>
            <span className="text-xs text-text-muted font-normal">
              / {summary.totalRequests.toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {summary.totalRequests > 0
              ? `${((summary.cachedRequests / summary.totalRequests) * 100).toFixed(1)}% aller Anfragen nutzen Cache`
              : "Keine Anfragen"}
          </p>
          <div className="mt-3 w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-purple-500 h-full rounded-full transition-all duration-500"
              style={{
                width: `${summary.totalRequests > 0 ? Math.min(100, (summary.cachedRequests / summary.totalRequests) * 100) : 0}%`,
              }}
            />
          </div>
        </Card>
      </div>

      {/* Chart.js Visuals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Timeline Chart (2 cols) */}
        <Card padding="md" className="lg:col-span-2 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-text-main">Cache-Verlauf über Zeit</h2>
              <p className="text-xs text-text-muted">Verhältnis von gecachten zu ungecachten Tokens &amp; Hit-Rate</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                Chart.js
              </span>
            </div>
          </div>
          <div className="relative h-[320px] w-full">
            <canvas ref={timelineCanvasRef} />
          </div>
        </Card>

        {/* Provider Distribution Doughnut (1 col) */}
        <Card padding="md" className="flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-text-main">Cache-Volumen nach Provider</h2>
              <p className="text-xs text-text-muted">Wer liefert die meisten gecachten Tokens?</p>
            </div>
          </div>
          <div className="relative flex-1 min-h-[280px] w-full flex items-center justify-center">
            {data.byProvider?.some((p) => p.cachedTokens > 0) ? (
              <canvas ref={providerCanvasRef} />
            ) : (
              <div className="text-center text-text-muted text-sm">
                Keine gecachten Tokens in diesem Zeitraum
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Provider Efficiency Table */}
      <Card padding="none" className="overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-main">Provider Effizienz-Vergleich</h2>
            <p className="text-xs text-text-muted">Hit-Rate und eingesparte Tokens pro Anbieter</p>
          </div>
          <span className="text-xs text-text-muted font-mono">{data.byProvider?.length || 0} Provider</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-xs font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-4">Provider</th>
                <th className="p-4 text-right">Gesamt Prompts</th>
                <th className="p-4 text-right text-emerald-600 dark:text-emerald-400">Gecacht</th>
                <th className="p-4 text-right text-text-muted">Neu / Ungecacht</th>
                <th className="p-4 text-left w-48">Effizienz (Hit-Rate)</th>
                <th className="p-4 text-right">Requests</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.byProvider?.map((p) => {
                const hitColor =
                  p.hitRate >= 70
                    ? "bg-emerald-500"
                    : p.hitRate >= 40
                    ? "bg-blue-500"
                    : p.hitRate >= 20
                    ? "bg-amber-500"
                    : "bg-slate-400";

                return (
                  <tr key={p.provider} className="hover:bg-surface-2/40 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: p.color }}
                        />
                        <div>
                          <div className="font-medium text-text-main">{p.name}</div>
                          <div className="text-xs text-text-muted font-mono">{p.provider}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right font-mono font-medium text-text-main">
                      {fmtTokens(p.promptTokens)}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {fmtTokens(p.cachedTokens)}
                    </td>
                    <td className="p-4 text-right font-mono text-text-muted">
                      {fmtTokens(p.uncachedTokens)}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-sm w-12 text-right text-text-main">
                          {p.hitRate}%
                        </span>
                        <div className="flex-1 bg-surface-2 rounded-full h-2 overflow-hidden max-w-[140px]">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${hitColor}`}
                            style={{ width: `${Math.min(100, Math.max(0, p.hitRate))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right font-mono text-text-muted">
                      {p.requests.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Live Recent Request Cache Inspector */}
      <Card padding="none" className="overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-text-main">Live Request Cache-Inspector</h2>
            <Badge variant="outline" size="sm" className="font-mono text-xs">
              Letzte 20 Anfragen
            </Badge>
          </div>
          <span className="text-xs text-text-muted">Echtzeit-Prüfung der Cache-Treffer</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-3.5">Zeitpunkt</th>
                <th className="p-3.5">Provider / Modell</th>
                <th className="p-3.5 text-center">Status</th>
                <th className="p-3.5 text-right">Gesamt Prompt</th>
                <th className="p-3.5 text-right text-emerald-600 dark:text-emerald-400">Gecacht</th>
                <th className="p-3.5 text-right">Cache Erstellt</th>
                <th className="p-3.5 text-right">Effizienz</th>
                <th className="p-3.5 text-right">Latenz</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.recentRequests?.length > 0 ? (
                data.recentRequests.map((req, idx) => (
                  <tr key={req.id || idx} className="hover:bg-surface-2/40 transition-colors">
                    <td className="p-3.5 text-text-muted whitespace-nowrap">
                      {timeAgo(req.timestamp)}
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-col">
                        <span className="font-mono font-semibold text-text-main text-xs truncate max-w-[200px]" title={req.model}>
                          {req.model}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {req.providerName || req.provider}
                        </span>
                      </div>
                    </td>
                    <td className="p-3.5 text-center whitespace-nowrap">
                      {req.isCached ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          CACHE HIT
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                          MISS
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right font-mono font-medium text-text-main">
                      {req.promptTokens.toLocaleString()}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {req.cachedTokens > 0 ? req.cachedTokens.toLocaleString() : "—"}
                    </td>
                    <td className="p-3.5 text-right font-mono text-text-muted">
                      {req.cacheCreationTokens > 0 ? req.cacheCreationTokens.toLocaleString() : "—"}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold">
                      {req.cachedTokens > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {req.hitRate}%
                        </span>
                      ) : (
                        <span className="text-text-muted">0%</span>
                      )}
                    </td>
                    <td className="p-3.5 text-right font-mono text-text-muted">
                      {req.latency ? `${req.latency}ms` : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-text-muted text-sm">
                    Keine aktuellen Request-Details gefunden.
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
