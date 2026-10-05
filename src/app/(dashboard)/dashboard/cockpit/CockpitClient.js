"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Chart from "chart.js/auto";
import { Card, Button, Badge, SegmentedControl, Toggle, CardSkeleton, JevTierSlider } from "@/shared/components";
import { usePersistentState } from "@/shared/hooks";
import { getModelTier } from "@/sse/services/modelTiers.js";
import CompactQuotaTracker from "./CompactQuotaTracker";
import ActiveSessionsVisualizer from "./ActiveSessionsVisualizer";

const PERIODS = [
  { value: "today", label: "Heute" },
  { value: "24h", label: "24 Std" },
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "60d", label: "60 Tage" },
];

const TOKEN_FLOW_PERIODS = [
  { value: "live", label: "Live" },
  { value: "1h", label: "1 Std" },
  { value: "3h", label: "3 Std" },
  { value: "6h", label: "6 Std" },
  { value: "12h", label: "12 Std" },
  { value: "24h", label: "24 Std" },
  { value: "3d", label: "3 Tage" },
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

const PROVIDER_COLORS = {
  claude: "#D97706",
  glm: "#2563EB",
  codex: "#10B981",
  gemini: "#8B5CF6",
  opencode: "#EC4899",
  ollama: "#64748B",
  "cloudflare-ai": "#F97316",
  github: "#1F2937",
  nvidia: "#76B900",
};

export default function CockpitClient() {
  const [period, setPeriod] = usePersistentState("9router_period", "7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = usePersistentState("9router_cockpit_auto_refresh", true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accountFilter, setAccountFilter] = useState("all");
  const [togglingId, setTogglingId] = useState(null);

  // Token Saver state
  const [saverSettings, setSaverSettings] = useState({
    rtkEnabled: true,
    cavemanEnabled: false,
    cavemanLevel: "full",
    ponytailEnabled: false,
    ponytailLevel: "full",
    headroomEnabled: false,
    headroomUrl: "http://localhost:8787",
  });
  const [headroomStatus, setHeadroomStatus] = useState({
    running: false,
    installed: false,
    loading: true,
  });
  const [updatingSaver, setUpdatingSaver] = useState(null);
  // "Modell-Klasse" slider: soft tier bias for Jev; never removes candidates
  const [jevTierPreference, setJevTierPreference] = useState("balanced");
  const [savingTier, setSavingTier] = useState(false);
  // Lokale Modelle ('local-first') ausschließen
  const [jevExcludeLocalModels, setJevExcludeLocalModels] = useState(true);
  const [savingExcludeLocal, setSavingExcludeLocal] = useState(false);
  // Jev candidates table state
  const [jevModels, setJevModels] = useState([]);
  const [jevModelsLoading, setJevModelsLoading] = useState(false);
  const [jevViewMode, setJevViewMode] = useState("table"); // "table" | "bars"
  const [showAllJevModels, setShowAllJevModels] = useState(false);

  const loadSaverSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const s = await res.json();
        setSaverSettings({
          rtkEnabled: s.rtkEnabled !== false,
          cavemanEnabled: !!s.cavemanEnabled,
          cavemanLevel: s.cavemanLevel || "full",
          ponytailEnabled: !!s.ponytailEnabled,
          ponytailLevel: s.ponytailLevel || "full",
          headroomEnabled: !!s.headroomEnabled,
          headroomUrl: s.headroomUrl || "http://localhost:8787",
        });
        setJevTierPreference(s.jevTierPreference || "balanced");
        setJevExcludeLocalModels(s.jevExcludeLocalModels !== false);
      }
    } catch (err) {
      console.error("[Cockpit] Error loading settings:", err);
    }
    try {
      const hrRes = await fetch("/api/headroom/status", { headers: { "Cache-Control": "no-store" } });
      if (hrRes.ok) {
        const hr = await hrRes.json();
        setHeadroomStatus({
          running: !!hr.running,
          installed: !!hr.installed,
          loading: false,
        });
      }
    } catch {
      setHeadroomStatus({ running: false, installed: false, loading: false });
    }
  }, []);

  useEffect(() => {
    loadSaverSettings();
  }, [loadSaverSettings]);

  const handleUpdateSaverSetting = async (patch) => {
    setSaverSettings((prev) => ({ ...prev, ...patch }));
    const key = Object.keys(patch)[0];
    setUpdatingSaver(key);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.error("[Cockpit] Error updating saver setting:", err);
    } finally {
      setUpdatingSaver(null);
    }
  };

  const handleUpdateTierPreference = async (id) => {
    const previous = jevTierPreference;
    setJevTierPreference(id);
    setSavingTier(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jevTierPreference: id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[Cockpit] Error updating Jev tier preference:", err);
      setJevTierPreference(previous);
    } finally {
      setSavingTier(false);
    }
  };

  const handleUpdateExcludeLocalModels = async (exclude) => {
    const previous = jevExcludeLocalModels;
    setJevExcludeLocalModels(exclude);
    setSavingExcludeLocal(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jevExcludeLocalModels: exclude }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[Cockpit] Error updating Jev exclude local models setting:", err);
      setJevExcludeLocalModels(previous);
    } finally {
      setSavingExcludeLocal(false);
    }
  };

  // Live real-time token stream state
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveRate, setLiveRate] = useState({ inRate: 0, outRate: 0 });
  const [activeAccountPings, setActiveAccountPings] = useState({});

  // Chart refs
  const [liveCanvasEl, setLiveCanvasEl] = useState(null);
  const liveChartInstance = useRef(null);
  const livePointsRef = useRef(
    Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() - (29 - i) * 2500);
      return {
        time: d.toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        tokensIn: 0,
        tokensOut: 0,
      };
    })
  );

  const cacheChartCanvasRef = useRef(null);
  const cacheChartInstance = useRef(null);

  const prevRequestsRef = useRef(new Set());

  // Token flow time-range state ("live" | "1h" | "3h" | "6h" | "12h" | "24h" | "3d")
  const [flowRange, setFlowRange] = usePersistentState("9router_cockpit_flow_range", "live");
  const flowRangeRef = useRef("live");
  const [historicalFlowData, setHistoricalFlowData] = useState(null);
  const [flowLoading, setFlowLoading] = useState(false);

  useEffect(() => {
    flowRangeRef.current = flowRange;
  }, [flowRange]);

  const fetchHistoricalFlow = useCallback(async (range) => {
    if (range === "live") {
      setHistoricalFlowData(null);
      if (liveChartInstance.current) {
        liveChartInstance.current.data.labels = livePointsRef.current.map((p) => p.time);
        liveChartInstance.current.data.datasets[0].data = livePointsRef.current.map((p) => p.tokensIn);
        liveChartInstance.current.data.datasets[1].data = livePointsRef.current.map((p) => p.tokensOut);
        liveChartInstance.current.update();
      }
      return;
    }

    setFlowLoading(true);
    try {
      const res = await fetch(`/api/usage/token-flow?range=${range}`);
      if (res.ok) {
        const json = await res.json();
        setHistoricalFlowData(json);
        if (liveChartInstance.current && flowRangeRef.current === range) {
          liveChartInstance.current.data.labels = json.points.map((p) => p.time);
          liveChartInstance.current.data.datasets[0].data = json.points.map((p) => p.tokensIn);
          liveChartInstance.current.data.datasets[1].data = json.points.map((p) => p.tokensOut);
          liveChartInstance.current.update();
        }
      }
    } catch (err) {
      console.error("[Cockpit] Error loading historical token flow:", err);
    } finally {
      setFlowLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistoricalFlow(flowRange);
  }, [flowRange, fetchHistoricalFlow]);

  // Fetch Cockpit data
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setIsRefreshing(true);
    try {
      const [res, jevRes, combosRes] = await Promise.all([
        fetch(`/api/dashboard/cockpit?period=${period}`),
        fetch("/api/debug/jev").catch(() => null),
        fetch("/api/combos").catch(() => null),
      ]);
      if (res.ok) {
        const json = await res.json();
        setData(json);

        // Detect new requests to trigger live pulses
        if (json.recentRequests?.length > 0) {
          const newPings = {};
          for (const req of json.recentRequests) {
            const reqKey = `${req.id || req.timestamp}-${req.model}`;
            if (!prevRequestsRef.current.has(reqKey)) {
              prevRequestsRef.current.add(reqKey);
              if (req.provider) newPings[req.provider] = Date.now();
            }
          }
          if (Object.keys(newPings).length > 0) {
            setActiveAccountPings((prev) => ({ ...prev, ...newPings }));
          }
        }
      }

      // Collect candidate models from latest criteria or combo
      let pool = [];
      if (jevRes && jevRes.ok) {
        const debugData = await jevRes.json();
        const latest = debugData.log?.[0];
        if (latest?.modelCriteria) {
          pool = Object.keys(latest.modelCriteria);
        }
      }
      if (pool.length === 0 && combosRes && combosRes.ok) {
        const cJson = await combosRes.json();
        const jevCombo = cJson.combos?.find((c) => c.name === "jev");
        if (jevCombo?.models?.length > 0) {
          pool = jevCombo.models;
        }
      }
      if (pool.length > 0) {
        setJevModels(pool);
      }
    } catch (err) {
      console.error("[Cockpit] Error loading cockpit data:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live SSE connection for real-time streaming
  useEffect(() => {
    let eventSource = null;
    let fallbackInterval = null;

    try {
      eventSource = new EventSource("/api/usage/stream");
      eventSource.onopen = () => {
        setLiveConnected(true);
      };

      eventSource.onmessage = (event) => {
        if (!event.data || event.data.startsWith(":")) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.recentRequests?.length > 0) {
            let deltaIn = 0;
            let deltaOut = 0;
            const nowTime = new Date().toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const pings = {};

            for (const r of payload.recentRequests.slice(0, 5)) {
              const rKey = `${r.timestamp}-${r.model}-${r.promptTokens}`;
              if (!prevRequestsRef.current.has(rKey)) {
                prevRequestsRef.current.add(rKey);
                deltaIn += Number(r.promptTokens || 0);
                deltaOut += Number(r.completionTokens || 0);
                if (r.provider) pings[r.provider] = Date.now();
                if (r.connectionId) pings[r.connectionId] = Date.now();
              }
            }

            if (Object.keys(pings).length > 0) {
              setActiveAccountPings((prev) => ({ ...prev, ...pings }));
            }

            // Push to rolling live points
            const currentPoints = [...livePointsRef.current];
            currentPoints.shift();
            currentPoints.push({
              time: nowTime,
              tokensIn: deltaIn,
              tokensOut: deltaOut,
            });
            livePointsRef.current = currentPoints;
            setLiveRate({ inRate: deltaIn, outRate: deltaOut });

            // Update live chart directly
            if (liveChartInstance.current && flowRangeRef.current === "live") {
              liveChartInstance.current.data.labels = currentPoints.map((p) => p.time);
              liveChartInstance.current.data.datasets[0].data = currentPoints.map((p) => p.tokensIn);
              liveChartInstance.current.data.datasets[1].data = currentPoints.map((p) => p.tokensOut);
              liveChartInstance.current.update("none");
            }
          }
        } catch {
          // JSON parse error ignore
        }
      };

      eventSource.onerror = () => {
        setLiveConnected(false);
      };
    } catch {
      setLiveConnected(false);
    }

    // Secondary ticker (every 2 seconds pushes tick so graph slides smoothly)
    fallbackInterval = setInterval(() => {
      const nowTime = new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const currentPoints = [...livePointsRef.current];
      // Only push zero tick if no new tokens arrived in last tick
      currentPoints.shift();
      currentPoints.push({
        time: nowTime,
        tokensIn: 0,
        tokensOut: 0,
      });
      livePointsRef.current = currentPoints;

      if (liveChartInstance.current && flowRangeRef.current === "live") {
        liveChartInstance.current.data.labels = currentPoints.map((p) => p.time);
        liveChartInstance.current.data.datasets[0].data = currentPoints.map((p) => p.tokensIn);
        liveChartInstance.current.data.datasets[1].data = currentPoints.map((p) => p.tokensOut);
        liveChartInstance.current.update("none");
      }
    }, 2500);

    return () => {
      if (eventSource) eventSource.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, []);

  // Periodic cockpit refresh (10s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchData(true);
      if (flowRangeRef.current !== "live") {
        fetchHistoricalFlow(flowRangeRef.current);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData, fetchHistoricalFlow]);

  // Toggle Account Active / Inactive
  const handleToggleAccount = async (account) => {
    if (togglingId) return;
    const newActiveState = !account.isActive;
    setTogglingId(account.id);

    // Optimistic UI update
    setData((prev) => {
      if (!prev) return prev;
      const updatedAccounts = prev.accounts.map((a) =>
        a.id === account.id ? { ...a, isActive: newActiveState } : a
      );
      const activeCount = updatedAccounts.filter((a) => a.isActive).length;
      return {
        ...prev,
        accounts: updatedAccounts,
        kpis: { ...prev.kpis, activeAccountsCount: activeCount },
      };
    });

    try {
      const res = await fetch(`/api/providers/${account.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newActiveState }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch (err) {
      console.error("[Cockpit] Error toggling account:", err);
      // Revert optimistic update
      setData((prev) => {
        if (!prev) return prev;
        const reverted = prev.accounts.map((a) =>
          a.id === account.id ? { ...a, isActive: !newActiveState } : a
        );
        const activeCount = reverted.filter((a) => a.isActive).length;
        return {
          ...prev,
          accounts: reverted,
          kpis: { ...prev.kpis, activeAccountsCount: activeCount },
        };
      });
    } finally {
      setTogglingId(null);
    }
  };

  // Initialize Live Token Flow Chart (Chart.js)
  useEffect(() => {
    if (!liveCanvasEl) return;

    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const textColor = isDark ? "#94A3B8" : "#64748B";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)";
    const tooltipBg = isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.98)";
    const tooltipText = isDark ? "#F8FAFC" : "#0F172A";

    if (liveChartInstance.current) {
      liveChartInstance.current.destroy();
      liveChartInstance.current = null;
    }

    const ctx = liveCanvasEl.getContext("2d");
    const isHistorical = flowRangeRef.current !== "live" && historicalFlowData;
    const labels = isHistorical
      ? historicalFlowData.points.map((p) => p.time)
      : livePointsRef.current.map((p) => p.time);
    const dataIn = isHistorical
      ? historicalFlowData.points.map((p) => p.tokensIn)
      : livePointsRef.current.map((p) => p.tokensIn);
    const dataOut = isHistorical
      ? historicalFlowData.points.map((p) => p.tokensOut)
      : livePointsRef.current.map((p) => p.tokensOut);

    liveChartInstance.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Tokens IN (Prompt an Jev/Accounts)",
            data: dataIn,
            borderColor: "#10B981",
            backgroundColor: "rgba(16, 185, 129, 0.15)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: isHistorical ? 2.5 : 2,
            pointHoverRadius: 5,
          },
          {
            label: "Tokens OUT (Completion von Accounts)",
            data: dataOut,
            borderColor: "#6366F1",
            backgroundColor: "rgba(99, 102, 241, 0.15)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: isHistorical ? 2.5 : 2,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { color: textColor, usePointStyle: true, font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            padding: 10,
            callbacks: {
              label(context) {
                const label = context.dataset.label?.split(" ")[0] || "";
                const val = context.parsed.y || 0;
                return ` ${label}: ${Number(val).toLocaleString()} Tokens`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 8 },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              callback: (v) => fmtTokens(v),
              font: { size: 10 },
            },
            beginAtZero: true,
            suggestedMax: 10,
          },
        },
      },
    });

    return () => {
      if (liveChartInstance.current) {
        liveChartInstance.current.destroy();
        liveChartInstance.current = null;
      }
    };
  }, [liveCanvasEl]);

  // Initialize Cache timeline Chart (Chart.js)
  useEffect(() => {
    if (!data?.cache?.timeSeries?.length || loading) return;

    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const textColor = isDark ? "#94A3B8" : "#64748B";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)";
    const tooltipBg = isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.98)";
    const tooltipText = isDark ? "#F8FAFC" : "#0F172A";

    if (cacheChartCanvasRef.current) {
      if (cacheChartInstance.current) {
        cacheChartInstance.current.destroy();
      }

      const labels = data.cache.timeSeries.map((t) => t.label);
      const cachedTokens = data.cache.timeSeries.map((t) => t.cachedTokens);
      const uncachedTokens = data.cache.timeSeries.map((t) => t.uncachedTokens);
      const hitRates = data.cache.timeSeries.map((t) => t.hitRate);

      const ctx = cacheChartCanvasRef.current.getContext("2d");
      cacheChartInstance.current = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              type: "line",
              label: "Hit-Rate (%)",
              data: hitRates,
              borderColor: "#F59E0B",
              backgroundColor: "#F59E0B",
              borderWidth: 2,
              pointRadius: 3,
              yAxisID: "yRate",
              tension: 0.3,
              order: 1,
            },
            {
              type: "bar",
              label: "Gecacht",
              data: cachedTokens,
              backgroundColor: "rgba(16, 185, 129, 0.85)",
              borderRadius: 4,
              stack: "tokens",
              yAxisID: "yTokens",
              order: 2,
            },
            {
              type: "bar",
              label: "Ungecacht",
              data: uncachedTokens,
              backgroundColor: isDark ? "rgba(99, 102, 241, 0.45)" : "rgba(99, 102, 241, 0.6)",
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
          plugins: {
            legend: {
              position: "top",
              labels: { color: textColor, usePointStyle: true, font: { size: 10 } },
            },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: tooltipText,
              bodyColor: tooltipText,
              padding: 10,
              callbacks: {
                label(context) {
                  const label = context.dataset.label || "";
                  const val = context.parsed.y;
                  if (context.dataset.yAxisID === "yRate") return ` ${label}: ${val.toFixed(1)}%`;
                  return ` ${label}: ${fmtTokens(val)}`;
                },
              },
            },
          },
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
            yTokens: {
              type: "linear",
              position: "left",
              grid: { color: gridColor },
              ticks: { color: textColor, callback: (v) => fmtTokens(v), font: { size: 10 } },
            },
            yRate: {
              type: "linear",
              position: "right",
              min: 0,
              max: 100,
              grid: { drawOnChartArea: false },
              ticks: { color: "#F59E0B", callback: (v) => v + "%", font: { size: 10 } },
            },
          },
        },
      });
    }

    return () => {
      if (cacheChartInstance.current) cacheChartInstance.current.destroy();
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

  const kpis = data?.kpis || {
    jevDecisions: 0,
    jevSuccessRate: 100,
    jevAvgLatencyMs: 0,
    cacheHitRate: 0,
    totalCachedTokens: 0,
    totalPromptTokens: 0,
    estimatedSavingsUsd: 0,
    activeAccountsCount: 0,
    totalAccountsCount: 0,
  };

  const jev = data?.jev || { topChoices: [], callers: {}, requests: 0 };
  const accounts = data?.accounts || [];
  const filteredAccounts = accounts.filter((a) => {
    if (accountFilter === "active") return a.isActive;
    if (accountFilter === "inactive") return !a.isActive;
    return true;
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Top Header & Period Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-main tracking-tight">Cockpit &amp; Operations</h1>
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" title="Live System" />
          </div>
          <p className="text-sm text-text-muted mt-0.5">
            Zentrales Dashboard für Live-Tokenfluss, Jev Router, Cache-Effizienz und Account-Steuerung
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
            onClick={() => {
              fetchData(false);
              if (flowRange !== "live") fetchHistoricalFlow(flowRange);
            }}
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

      {/* 4 Hero KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Jev Routing Card */}
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Jev Routing Engine
            </span>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <span className="material-symbols-outlined text-[20px]">alt_route</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-text-main">
              {kpis.jevDecisions.toLocaleString()}
            </span>
            <Badge variant="success" size="sm">
              {kpis.jevSuccessRate}% OK
            </Badge>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
            <span>Fallbacks: {kpis.jevFallbacks || 0}</span>
            <span>Ø {kpis.jevAvgLatencyMs}ms Latenz</span>
          </div>
          <div className="mt-3 w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full"
              style={{ width: `${kpis.jevSuccessRate}%` }}
            />
          </div>
        </Card>

        {/* Cache Hit-Rate Card */}
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Cache Effizienz
            </span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <span className="material-symbols-outlined text-[20px]">bolt</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {kpis.cacheHitRate}%
            </span>
            <Badge variant="success" size="sm">
              {fmtTokens(kpis.totalCachedTokens)} Gecacht
            </Badge>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
            <span>Von {fmtTokens(kpis.totalPromptTokens)} Prompts</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">~${kpis.estimatedSavingsUsd} gespart</span>
          </div>
          <div className="mt-3 w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full"
              style={{ width: `${Math.min(100, kpis.cacheHitRate)}%` }}
            />
          </div>
        </Card>

        {/* Aktive Accounts Card */}
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Verbundene Accounts
            </span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <span className="material-symbols-outlined text-[20px]">group</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-text-main">
              {kpis.activeAccountsCount}
            </span>
            <span className="text-sm text-text-muted font-mono">
              / {kpis.totalAccountsCount} aktiv
            </span>
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {kpis.totalAccountsCount - kpis.activeAccountsCount} pausiert / inaktiv
          </div>
          <div className="mt-3 w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full"
              style={{
                width: `${(kpis.activeAccountsCount / (kpis.totalAccountsCount || 1)) * 100}%`,
              }}
            />
          </div>
        </Card>

        {/* Traffic Gesamt Card */}
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Gesamt Requests
            </span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <span className="material-symbols-outlined text-[20px]">swap_horiz</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-text-main">
              {kpis.totalRequests.toLocaleString()}
            </span>
          </div>
          <div className="mt-1 text-xs text-text-muted truncate">
            {fmtTokens(kpis.totalPromptTokens)} In • {fmtTokens(data.cache?.summary?.totalCompletionTokens || 0)} Out
          </div>
          <div className="mt-3 text-xs text-text-muted flex items-center justify-between font-mono">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] text-emerald-500">check_circle</span>
              <span>Pfade stabil</span>
            </div>
            {data?.sessions?.activeCount > 0 ? (
              <span className="text-emerald-500 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {data.sessions.activeCount} aktiv
              </span>
            ) : (
              <span className="text-text-muted">
                {data?.sessions?.totalCount || 0} Sessions
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* TOKEN STREAMING & FLOW TIMELINE CHART */}
      <Card padding="md" className="flex flex-col border-emerald-500/20 bg-gradient-to-b from-surface to-surface-2/30">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-3 w-3">
              {flowRange === "live" ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text-main tracking-tight">
                  {flowRange === "live"
                    ? "Live Token Flow Stream"
                    : `Token Flow Verlauf (${TOKEN_FLOW_PERIODS.find((p) => p.value === flowRange)?.label || flowRange})`}
                </h2>
                <Badge variant="outline" size="sm" className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                  {flowRange === "live" ? (liveConnected ? "SSE STREAM AKTIV" : "POLLING AKTIV") : `${flowRange.toUpperCase()} VERLAUF`}
                </Badge>
                {flowLoading && (
                  <span className="material-symbols-outlined text-[15px] text-text-muted animate-spin">
                    progress_activity
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted">
                {flowRange === "live"
                  ? "Echtzeit-Verfolgung der ein- und ausgehenden Tokens durch Jev und die Accounts"
                  : `Historischer Verlauf der Prompt- und Completion-Tokens über ${TOKEN_FLOW_PERIODS.find((p) => p.value === flowRange)?.label || flowRange}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            {/* Zeitspannen-Auswahl: Live, 1h, 3h, 6h, 12h, 24h, 3d */}
            <SegmentedControl
              options={TOKEN_FLOW_PERIODS}
              value={flowRange}
              onChange={setFlowRange}
              size="sm"
            />

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                <span>
                  IN: {fmtTokens(flowRange === "live" ? liveRate.inRate : historicalFlowData?.totalTokensIn || 0)}
                  {flowRange === "live" ? " /s" : " gesamt"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300">
                <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                <span>
                  OUT: {fmtTokens(flowRange === "live" ? liveRate.outRate : historicalFlowData?.totalTokensOut || 0)}
                  {flowRange === "live" ? " /s" : " gesamt"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Live / Historical Chart.js Canvas */}
        <div className="relative h-[220px] w-full">
          <canvas ref={setLiveCanvasEl} />
        </div>
      </Card>

      {/* TOKEN SAVER & COMPRESSION ENGINES */}
      <Card padding="md" className="border-border/80">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <span className="material-symbols-outlined text-[20px]">savings</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text-main tracking-tight">
                  Token Saver &amp; Komprimierungs-Engines
                </h2>
                <Badge
                  variant={saverSettings.rtkEnabled || saverSettings.cavemanEnabled || saverSettings.ponytailEnabled || saverSettings.headroomEnabled ? "success" : "outline"}
                  size="sm"
                  className="font-mono text-[11px]"
                >
                  {saverSettings.rtkEnabled || saverSettings.cavemanEnabled || saverSettings.ponytailEnabled || saverSettings.headroomEnabled ? "AKTIV" : "STANDBY"}
                </Badge>
              </div>
              <p className="text-xs text-text-muted">
                4 integrierte Technologien zur drastischen Senkung von Input- und Output-Tokens (bis zu 90% Ersparnis)
              </p>
            </div>
          </div>
          <a
            href="/dashboard/token-saver"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <span>Detaillierte Konfiguration &amp; Extras</span>
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* RTK (Tool Trimmer) */}
          <div className="p-3.5 rounded-xl bg-surface-2/40 border border-border/60 flex flex-col justify-between hover:border-border transition-all">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <span className="material-symbols-outlined text-[18px]">terminal</span>
                  </span>
                  <span className="font-semibold text-text-main text-sm">RTK Tool Trimmer</span>
                </div>
                <Toggle
                  checked={saverSettings.rtkEnabled}
                  onChange={(val) => handleUpdateSaverSetting({ rtkEnabled: val })}
                  size="sm"
                  disabled={updatingSaver === "rtkEnabled"}
                />
              </div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  saverSettings.rtkEnabled
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-surface-3 text-text-muted"
                }`}>
                  {saverSettings.rtkEnabled ? "60–90% Input-Ersparnis" : "Deaktiviert"}
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                Filtert und stutzt riesige Tool-Outputs wie <code className="text-[10px] font-mono bg-surface-2 px-1 py-0.5 rounded">git diff</code>, <code className="text-[10px] font-mono bg-surface-2 px-1 py-0.5 rounded">grep</code>, Verzeichnisbäume und Test-Logs, bevor sie das Prompt-Budget belasten.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-border/40 text-[11px] text-text-muted flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] text-amber-500">flash_on</span>
              <span>Kürzt CLI- &amp; Bash-Ergebnisse</span>
            </div>
          </div>

          {/* Headroom (Context Proxy) */}
          <div className="p-3.5 rounded-xl bg-surface-2/40 border border-border/60 flex flex-col justify-between hover:border-border transition-all">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <span className="material-symbols-outlined text-[18px]">compress</span>
                  </span>
                  <span className="font-semibold text-text-main text-sm">Headroom Proxy</span>
                </div>
                <Toggle
                  checked={saverSettings.headroomEnabled}
                  onChange={(val) => handleUpdateSaverSetting({ headroomEnabled: val })}
                  size="sm"
                  disabled={updatingSaver === "headroomEnabled"}
                />
              </div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  saverSettings.headroomEnabled
                    ? (headroomStatus.running ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")
                    : "bg-surface-3 text-text-muted"
                }`}>
                  {saverSettings.headroomEnabled
                    ? (headroomStatus.running ? "Aktiv (20–50% Ersparnis)" : "Proxy gestoppt")
                    : "Deaktiviert"}
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                Lokaler Kompressions-Proxy für Chatverläufe &amp; Prompts via SmartCrusher (JSON) und AST-Parser für Code ohne semantischen Bedeutungsverlust.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-border/40 text-[11px] text-text-muted flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${headroomStatus.running ? "bg-emerald-500" : "bg-slate-400"}`} />
                <span>Port 8787</span>
              </span>
              <a href="/dashboard/token-saver" className="text-primary hover:underline text-[11px]">
                {headroomStatus.installed ? "Proxy Status" : "Setup"}
              </a>
            </div>
          </div>

          {/* Caveman (Output Compressor) */}
          <div className="p-3.5 rounded-xl bg-surface-2/40 border border-border/60 flex flex-col justify-between hover:border-border transition-all">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <span className="material-symbols-outlined text-[18px]">short_text</span>
                  </span>
                  <span className="font-semibold text-text-main text-sm">Caveman Output</span>
                </div>
                <Toggle
                  checked={saverSettings.cavemanEnabled}
                  onChange={(val) => handleUpdateSaverSetting({ cavemanEnabled: val })}
                  size="sm"
                  disabled={updatingSaver === "cavemanEnabled"}
                />
              </div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  saverSettings.cavemanEnabled
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-surface-3 text-text-muted"
                }`}>
                  {saverSettings.cavemanEnabled ? "~65% Output-Ersparnis" : "Deaktiviert"}
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed mb-2">
                Eliminiert Höflichkeitsfloskeln, Begrüßungen und Füllprosa. Zwingt das LLM zu telegrafischen Antworten und purem Code.
              </p>
            </div>
            {saverSettings.cavemanEnabled && (
              <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1">
                {["lite", "full", "ultra"].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => handleUpdateSaverSetting({ cavemanLevel: lvl })}
                    className={`flex-1 py-1 rounded text-[10px] font-mono uppercase font-semibold transition-colors ${
                      saverSettings.cavemanLevel === lvl
                        ? "bg-purple-600 text-white shadow-sm"
                        : "bg-surface text-text-muted hover:text-text-main border border-border/40"
                    }`}
                    title={lvl === "lite" ? "Ohne Füllwörter, normale Grammatik" : lvl === "full" ? "Keine Artikel/Füllsel, Fragmente erlaubt" : "Telegrafisch, maximale Kompression"}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Ponytail ("Lazy Senior Dev") */}
          <div className="p-3.5 rounded-xl bg-surface-2/40 border border-border/60 flex flex-col justify-between hover:border-border transition-all">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <span className="material-symbols-outlined text-[18px]">code</span>
                  </span>
                  <span className="font-semibold text-text-main text-sm">Ponytail (Senior Dev)</span>
                </div>
                <Toggle
                  checked={saverSettings.ponytailEnabled}
                  onChange={(val) => handleUpdateSaverSetting({ ponytailEnabled: val })}
                  size="sm"
                  disabled={updatingSaver === "ponytailEnabled"}
                />
              </div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  saverSettings.ponytailEnabled
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-surface-3 text-text-muted"
                }`}>
                  {saverSettings.ponytailEnabled ? "YAGNI Code-Bias" : "Deaktiviert"}
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed mb-2">
                Prägt dem LLM das "Lazy Senior Dev"-Prinzip ein: Wiederverwendung von Standard-Libraries, Löschen von Altlasten statt unnötigem Boilerplate.
              </p>
            </div>
            {saverSettings.ponytailEnabled && (
              <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1">
                {["lite", "full", "ultra"].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => handleUpdateSaverSetting({ ponytailLevel: lvl })}
                    className={`flex-1 py-1 rounded text-[10px] font-mono uppercase font-semibold transition-colors ${
                      saverSettings.ponytailLevel === lvl
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-surface text-text-muted hover:text-text-main border border-border/40"
                    }`}
                    title={lvl === "lite" ? "Minimalistischer, fauler Ansatz" : lvl === "full" ? "Stdlib & Native Funktionen zuerst" : "YAGNI Extremist, Löschen vor Hinzufügen"}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Grid: Jev Intelligent Routing & Cache Performance - Umbruch bei geringer Breite */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
        {/* Left: Jev Router Details */}
        <Card padding="md" className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <span className="material-symbols-outlined text-[18px]">psychology</span>
              </span>
              <div>
                <h2 className="text-base font-semibold text-text-main">Jev Routing Entscheidungen</h2>
                <p className="text-xs text-text-muted">Wohin Jev dynamisch weiterleitet</p>
              </div>
            </div>
            <Badge variant="outline" size="sm" className="font-mono">
              {jev.requests} Decisions
            </Badge>
          </div>

          <div className="flex-1 flex flex-col gap-4">
            {/* Modell-Klasse slider: biases Jev's choice without filtering candidates */}
            <div className="p-3 rounded-xl bg-surface-2/40 border border-border/60">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase text-text-muted tracking-wider">
                  Modell-Klasse
                </div>
                <Badge variant={jevTierPreference === "balanced" ? "outline" : "success"} size="sm" className="font-mono text-[11px]">
                  {savingTier ? "SPEICHERT…" : jevTierPreference === "balanced" ? "AUTO" : "AKTIV"}
                </Badge>
              </div>
              <JevTierSlider
                value={jevTierPreference}
                onChange={handleUpdateTierPreference}
                disabled={savingTier}
                compact
              />
            </div>

            {/* Lokale Modelle ('local-first') ausschließen */}
            <div className="p-3 rounded-xl bg-surface-2/40 border border-border/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="material-symbols-outlined text-[18px] text-text-muted shrink-0">
                  {jevExcludeLocalModels ? "cloud" : "devices"}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                    <span>Lokale Modelle ('local-first')</span>
                    <Badge variant={jevExcludeLocalModels ? "outline" : "success"} size="sm" className="text-[10px] font-mono">
                      {savingExcludeLocal ? "SPEICHERT…" : jevExcludeLocalModels ? "AUSGESCHLOSSEN" : "ERLAUBT"}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    {jevExcludeLocalModels ? "Nur Cloud-Modelle aktiv" : "Lokale Modelle fließen in Jev-Wahl ein"}
                  </div>
                </div>
              </div>
              <Toggle
                checked={jevExcludeLocalModels}
                onChange={handleUpdateExcludeLocalModels}
                disabled={savingExcludeLocal}
              />
            </div>

            {/* Jev Pool & Modell-Entscheidungen (Tabelle & Balkenansicht) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-text-muted tracking-wider">
                    Jev Modell-Pool &amp; Anfragen
                  </span>
                  <Badge variant="outline" size="sm" className="text-[10px] font-mono">
                    {(() => {
                      const allSet = new Set([
                        ...jevModels,
                        ...Object.keys(jev.choices || {}),
                        ...(jev.topChoices || []).map((c) => c.model),
                      ]);
                      return `${allSet.size} Modelle`;
                    })()}
                  </Badge>
                </div>
                <div className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border/50 text-[11px]">
                  <button
                    onClick={() => setJevViewMode("table")}
                    className={`px-2 py-0.5 rounded-md font-medium transition-colors flex items-center gap-1 ${
                      jevViewMode === "table"
                        ? "bg-surface text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[13px]">table_rows</span>
                    Tabelle
                  </button>
                  <button
                    onClick={() => setJevViewMode("bars")}
                    className={`px-2 py-0.5 rounded-md font-medium transition-colors flex items-center gap-1 ${
                      jevViewMode === "bars"
                        ? "bg-surface text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[13px]">bar_chart</span>
                    Top 5
                  </button>
                </div>
              </div>

              {jevViewMode === "table" ? (
                (() => {
                  const choicesMap = { ...(jev.choices || {}) };
                  for (const c of jev.topChoices || []) {
                    if (choicesMap[c.model] == null) choicesMap[c.model] = c.count;
                  }
                  const allModelNames = Array.from(new Set([
                    ...jevModels,
                    ...Object.keys(choicesMap),
                  ]));

                  if (allModelNames.length === 0) {
                    return (
                      <div className="text-center p-6 text-text-muted text-xs border border-border/50 rounded-xl bg-surface-2/30">
                        Keine Modelle im Pool gefunden.
                      </div>
                    );
                  }

                  const rows = allModelNames.map((model) => {
                    const count = choicesMap[model] || 0;
                    const pct = jev.requests > 0 ? Math.round((count / jev.requests) * 100) : 0;
                    const tier = getModelTier(model) || "unbekannt";
                    return { model, count, pct, tier };
                  }).sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return a.model.localeCompare(b.model);
                  });

                  const tierBadges = {
                    frontier: { bg: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30", label: "FRONTIER" },
                    strong: { bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30", label: "STRONG" },
                    mid: { bg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30", label: "MID" },
                    fast: { bg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", label: "FAST" },
                  };

                  const visibleRows = showAllJevModels ? rows : rows.slice(0, 10);
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-text-muted">
                        <span>Top {visibleRows.length} von {rows.length} Modellen · nach Entscheidungen sortiert</span>
                        {rows.length > 10 && <button type="button" onClick={() => setShowAllJevModels((value) => !value)} className="rounded border border-border/60 px-2 py-1 hover:bg-surface-2">{showAllJevModels ? "Weniger anzeigen" : `Alle ${rows.length} anzeigen`}</button>}
                      </div>
                      <div className={`overflow-x-auto rounded-xl border border-border/60 bg-surface/60 ${showAllJevModels ? "max-h-[340px] overflow-y-auto" : ""}`}>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b border-border text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                          <tr>
                            <th className="p-2.5">Kandidaten-Modell</th>
                            <th className="p-2.5 text-center">Tier</th>
                            <th className="p-2.5 text-right">Anfragen (Decisions)</th>
                            <th className="p-2.5 text-right">Anteil</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {visibleRows.map((row) => {
                            const badge = tierBadges[row.tier] || {
                              bg: "bg-surface-2 text-text-muted border-border/50",
                              label: row.tier.toUpperCase(),
                            };
                            const isChosen = row.count > 0;
                            return (
                              <tr
                                key={row.model}
                                className={`transition-colors hover:bg-surface-2/40 ${
                                  isChosen ? "bg-surface" : "opacity-60 bg-surface-2/10"
                                }`}
                              >
                                <td className="p-2.5">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        isChosen ? "bg-emerald-500" : "bg-slate-400"
                                      }`}
                                    />
                                    <span className="font-mono font-medium text-text-main truncate max-w-[260px]" title={row.model}>
                                      {row.model}
                                    </span>
                                  </div>
                                </td>
                                <td className="p-2.5 text-center">
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${badge.bg}`}>
                                    {badge.label}
                                  </span>
                                </td>
                                <td className="p-2.5 text-right font-mono font-semibold">
                                  <span className={isChosen ? "text-indigo-600 dark:text-indigo-400" : "text-text-muted"}>
                                    {row.count.toLocaleString()}
                                  </span>
                                </td>
                                <td className="p-2.5 text-right font-mono text-text-muted">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <span>{row.pct}%</span>
                                    <div className="w-10 bg-surface-2 rounded-full h-1 overflow-hidden shrink-0">
                                      <div
                                        className="bg-indigo-500 h-full rounded-full"
                                        style={{ width: `${Math.min(100, row.pct)}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  );
                })()
              ) : (
                jev.topChoices?.length > 0 ? (
                  <div className="space-y-2">
                    {jev.topChoices.map((choice, i) => {
                      const maxCount = jev.topChoices[0]?.count || 1;
                      const pct = Math.round((choice.count / (jev.requests || 1)) * 100);
                      return (
                        <div key={i} className="p-2 rounded-lg bg-surface-2/60 border border-border/50">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-mono font-medium text-text-main truncate max-w-[240px]">
                              {choice.model}
                            </span>
                            <span className="text-text-muted font-mono">
                              {choice.count.toLocaleString()} ({pct}%)
                            </span>
                          </div>
                          <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${(choice.count / maxCount) * 100}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center p-6 text-text-muted text-xs">
                    Keine Jev-Entscheidungen im Zeitraum verzeichnet.
                  </div>
                )
              )}
            </div>

            {/* Caller Sources */}
            {Object.keys(jev.callers || {}).length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase text-text-muted mb-1.5 tracking-wider">
                  Client / Caller Quellen
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(jev.callers).map(([caller, count]) => (
                    <span
                      key={caller}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 text-xs font-mono text-text-main border border-border/40"
                    >
                      <span>{caller}</span>
                      <span className="font-bold text-indigo-600 dark:text-indigo-400">
                        {count.toLocaleString()}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Right: Cache Performance Chart & Provider Hit-Rates */}
        <Card padding="md" className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <span className="material-symbols-outlined text-[18px]">cached</span>
              </span>
              <div>
                <h2 className="text-base font-semibold text-text-main">Prompt Cache Verlauf &amp; Hit-Rates</h2>
                <p className="text-xs text-text-muted">Effizienz pro Provider im Vergleich</p>
              </div>
            </div>
            <Badge variant="success" size="sm">
              {kpis.cacheHitRate}% Hit-Rate
            </Badge>
          </div>

          {/* Mini Chart */}
          <div className="relative h-[160px] w-full mb-3">
            <canvas ref={cacheChartCanvasRef} />
          </div>

          {/* Provider Hit-Rate Pills */}
          <div className="border-t border-border pt-3">
            <div className="text-xs font-semibold uppercase text-text-muted mb-2 tracking-wider">
              Hit-Rate nach Anbieter
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data.cache?.byProvider
                ?.filter((p) => p.promptTokens > 0)
                .slice(0, 6)
                .map((p) => (
                  <div
                    key={p.provider}
                    className="p-2 rounded-lg bg-surface-2/60 border border-border/50 flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-text-main truncate max-w-[100px]" title={p.name}>
                        {p.name.split(" ")[0]}
                      </span>
                      <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">
                        {p.hitRate}%
                      </span>
                    </div>
                    <div className="text-[11px] text-text-muted font-mono">
                      {fmtTokens(p.cachedTokens)} cached
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </Card>
      </div>

      {/* COMPACT REDESIGNED QUOTA TRACKER */}
      <CompactQuotaTracker />

      {/* ACTIVE SESSIONS & LIVE PINGS VISUALIZER */}
      <ActiveSessionsVisualizer initialSessions={data?.sessions} />

      {/* Account Steuerung & Kompakte Usage (The Core Interactive Section) */}
      <Card padding="none" className="overflow-hidden">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text-main">Account-Steuerung &amp; Kompakte Usage</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono">
                {kpis.activeAccountsCount} aktiv
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Direktes Aktivieren/Pausieren von Verbindungen mit Sofort-Speicherung
            </p>
          </div>

          {/* Filter Pills */}
          <div className="inline-flex p-1 rounded-lg bg-surface-2 border border-border/50 text-xs">
            <button
              onClick={() => setAccountFilter("all")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                accountFilter === "all"
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Alle ({accounts.length})
            </button>
            <button
              onClick={() => setAccountFilter("active")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                accountFilter === "active"
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Nur Aktive ({kpis.activeAccountsCount})
            </button>
            <button
              onClick={() => setAccountFilter("inactive")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                accountFilter === "inactive"
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Pausiert ({accounts.length - kpis.activeAccountsCount})
            </button>
          </div>
        </div>

        {/* Accounts Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/40 text-xs font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-3.5">Account / Name</th>
                <th className="p-3.5">Provider</th>
                <th className="p-3.5 text-center">Status (Schalter)</th>
                <th className="p-3.5 text-right">Requests</th>
                <th className="p-3.5 text-right">Prompt Tokens</th>
                <th className="p-3.5 text-right text-emerald-600 dark:text-emerald-400">Gecacht</th>
                <th className="p-3.5 text-right">Kosten / Credits</th>
                <th className="p-3.5 text-center">Prio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredAccounts.map((account) => {
                const isToggling = togglingId === account.id;
                const pColor = PROVIDER_COLORS[account.provider] || "#94A3B8";
                const isRecentlyActive =
                  activeAccountPings[account.id] &&
                  Date.now() - activeAccountPings[account.id] < 15000;

                return (
                  <tr
                    key={account.id}
                    className={`hover:bg-surface-2/40 transition-colors ${
                      !account.isActive ? "opacity-60 bg-surface-2/20" : ""
                    }`}
                  >
                    {/* Account Name */}
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            account.isActive
                              ? isRecentlyActive
                                ? "bg-emerald-400 animate-ping"
                                : "bg-emerald-500"
                              : "bg-slate-400"
                          }`}
                        />
                        <div>
                          <div className="font-semibold text-text-main flex items-center gap-1.5">
                            <span>{account.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-2 border border-border/60 text-text-muted uppercase font-mono">
                              {account.authType}
                            </span>
                            {isRecentlyActive && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono animate-pulse">
                                LIVE FLOW
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-text-muted font-mono truncate max-w-[220px]">
                            {account.id}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Provider */}
                    <td className="p-3.5">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border"
                        style={{
                          borderColor: `${pColor}40`,
                          backgroundColor: `${pColor}12`,
                          color: pColor,
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pColor }} />
                        {account.provider}
                      </span>
                    </td>

                    {/* Status Toggle Switch */}
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => handleToggleAccount(account)}
                        disabled={isToggling}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                          account.isActive ? "bg-emerald-500" : "bg-surface-2 border-border"
                        } ${isToggling ? "opacity-50 cursor-wait" : ""}`}
                        title={account.isActive ? "Klicken zum Pausieren" : "Klicken zum Aktivieren"}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            account.isActive ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>

                    {/* Requests */}
                    <td className="p-3.5 text-right font-mono text-text-main">
                      {account.requests > 0 ? account.requests.toLocaleString() : "—"}
                    </td>

                    {/* Prompt Tokens */}
                    <td className="p-3.5 text-right font-mono font-medium text-text-main">
                      {account.promptTokens > 0 ? fmtTokens(account.promptTokens) : "—"}
                    </td>

                    {/* Cached Tokens */}
                    <td className="p-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {account.cachedTokens > 0 ? (
                        <div className="flex flex-col items-end">
                          <span>{fmtTokens(account.cachedTokens)}</span>
                          <span className="text-[10px] text-emerald-600/80 font-normal">
                            ({account.hitRate}%)
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* Cost */}
                    <td className="p-3.5 text-right font-mono text-text-main">
                      {account.cost > 0 ? `$${account.cost.toFixed(2)}` : "$0.00"}
                    </td>

                    {/* Priority */}
                    <td className="p-3.5 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-surface-2 border border-border text-text-muted">
                        P{account.priority}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Live Routed Traffic Inspector */}
      <Card padding="none" className="overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-text-main">Live Routing Traffic</h2>
            <Badge variant="outline" size="sm" className="font-mono text-xs">
              Echtzeit Stream
            </Badge>
          </div>
          <span className="text-xs text-text-muted">Letzte verarbeitete Anfragen</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2/40 font-semibold text-text-muted uppercase tracking-wider">
                <th className="p-3">Zeitpunkt</th>
                <th className="p-3">Modell</th>
                <th className="p-3">Provider</th>
                <th className="p-3 text-center">Cache Status</th>
                <th className="p-3 text-right">Prompt Tokens</th>
                <th className="p-3 text-right text-emerald-600 dark:text-emerald-400">Gecacht</th>
                <th className="p-3 text-right">Latenz</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.recentRequests?.length > 0 ? (
                data.recentRequests.map((req, idx) => (
                  <tr key={req.id || idx} className="hover:bg-surface-2/40 transition-colors">
                    <td className="p-3 text-text-muted whitespace-nowrap">
                      {timeAgo(req.timestamp)}
                    </td>
                    <td className="p-3 font-mono font-semibold text-text-main truncate max-w-[220px]">
                      {req.model}
                    </td>
                    <td className="p-3">
                      <span className="font-medium text-text-main">{req.providerName || req.provider}</span>
                    </td>
                    <td className="p-3 text-center">
                      {req.isCached ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          HIT ({req.hitRate}%)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                          MISS
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono">{req.promptTokens.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {req.cachedTokens > 0 ? req.cachedTokens.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-right font-mono text-text-muted">
                      {req.latency ? `${req.latency}ms` : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="p-6 text-center text-text-muted text-xs">
                    Keine aktuellen Requests verzeichnet.
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
