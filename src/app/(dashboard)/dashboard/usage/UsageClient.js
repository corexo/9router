"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import PropTypes from "prop-types";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Badge, SegmentedControl, CardSkeleton } from "@/shared/components";
import { usePersistentState } from "@/shared/hooks";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

import OverviewCards from "./components/OverviewCards";
import UsageChart from "./components/UsageChart";
import UsageTable, { fmt, fmtTime, fmtCost } from "./components/UsageTable";
import RecentRequests from "./components/RecentRequests";
import RequestDetailsTab from "./components/RequestDetailsTab";
import ProviderLimits from "./components/ProviderLimits";
import ActiveQuotas from "./components/ActiveQuotas";
import PeakHoursBanner from "./components/PeakHoursBanner";
import JevStatsCard from "./components/JevStatsCard";
import JevChart from "./components/JevChart";
import ModelHealthCard from "./components/ModelHealthCard";
import JevRequestLogCard from "../debug/JevRequestLogCard";

// Lazy-load XYFlow topology
const ProviderTopology = dynamic(() => import("./components/ProviderTopology"), { ssr: false });

const PERIODS = [
  { value: "today", label: "Heute" },
  { value: "24h", label: "24 Std" },
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "60d", label: "60 Tage" },
];

const TABS = [
  { value: "overview", label: "Übersicht", icon: "dashboard" },
  { value: "analytics", label: "Analytics & Trends", icon: "monitoring" },
  { value: "details", label: "Request Explorer", icon: "receipt_long" },
  { value: "quota", label: "Quota Tracker", icon: "pie_chart" },
  { value: "jev", label: "Jev AI Router", icon: "alt_route" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Nach Modell", icon: "smart_toy" },
  { value: "account", label: "Nach Account", icon: "badge" },
  { value: "apiKey", label: "Nach API-Key", icon: "key" },
  { value: "endpoint", label: "Nach Endpoint", icon: "api" },
];

const VIEW_MODE_OPTIONS = [
  { value: "costs", label: "Kosten ($)", icon: "payments" },
  { value: "tokens", label: "Tokens", icon: "data_usage" },
];

function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      const cachedTokens = data.cachedTokens || 0;
      const nonCachedInput = Math.max(0, (data.promptTokens || 0) - cachedTokens);
      const inputCost = totalTokens > 0 ? nonCachedInput * (totalCost / totalTokens) : 0;
      const cachedCost = totalTokens > 0 ? cachedTokens * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? (data.completionTokens || 0) * (totalCost / totalTokens) : 0;
      return { ...data, key, totalTokens, totalCost, inputCost, cachedCost, outputCost, pending: pendingMap[key] || 0 };
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel": return item.rawModel || "Unbekanntes Modell";
    case "accountName": return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unbekannter Account";
    case "keyName": return item.keyName || "Unbekannter Key";
    case "endpoint": return item.endpoint || "Unbekannter Endpoint";
    default: return item[keyField] || "Unbekannt";
  }
}

function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, cachedCost: 0, outputCost: 0, lastUsed: null, pending: 0 },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.cachedTokens += item.cachedTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.cachedCost += item.cachedCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Modell" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Zuletzt genutzt", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Modell" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Zuletzt genutzt", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API-Key Name" },
  { field: "rawModel", label: "Modell" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Zuletzt genutzt", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Modell" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Zuletzt genutzt", align: "right" },
];

export default function UsageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [period, setPeriod] = usePersistentState("9router_period", "today");
  const [tableView, setTableView] = usePersistentState("9router_usage_table_view", "model");
  const [viewMode, setViewMode] = usePersistentState("9router_usage_view_mode", "costs");
  const [autoRefresh, setAutoRefresh] = usePersistentState("9router_usage_autorefresh", true);

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [providers, setProviders] = useState([]);
  const [sortBy, setSortBy] = useState("rawModel");
  const [sortOrder, setSortOrder] = useState("asc");

  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);

  // Tab management via URL
  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "analytics", "details", "quota", "jev"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  // Fetch connected providers once
  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, nodesData]) => {
        const nodeNameMap = {};
        for (const node of nodesData?.nodes || []) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set();
        const unique = (d?.connections || [])
          .filter((c) => {
            if (c.isActive === false) return false;
            if (!isLLMProvider(c.provider)) return false;
            if (seen.has(c.provider)) return false;
            seen.add(c.provider);
            return true;
          })
          .map((c) => ({
            ...c,
            nodeName: nodeNameMap[c.provider] || null,
          }));
        const noAuthProviders = Object.values(FREE_PROVIDERS)
          .filter((p) => p.noAuth && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
  }, []);

  // Fetch filtered stats via REST when period changes
  const loadStats = useCallback(
    (isManual = false) => {
      if (isManual || isInitialLoad.current) {
        if (isInitialLoad.current) setLoading(true);
        else setFetching(true);
        isInitialLoad.current = false;
      } else {
        setFetching(true);
      }

      fetch(`/api/usage/stats?period=${period}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            hasLoadedStats.current = true;
            setStats((prev) => ({ ...prev, ...data }));
          }
        })
        .catch(() => {})
        .finally(() => {
          setLoading(false);
          setFetching(false);
        });
    },
    [period]
  );

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Periodic refresh when autoRefresh is enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadStats();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadStats]);

  // SSE real-time connection for activeRequests + recentRequests
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending: data.pending,
          };
        });
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => es.close();
  }, []);

  const toggleSort = useCallback((tableType, field) => {
    setSortBy((prevField) => {
      if (prevField === field) {
        setSortOrder((prevOrder) => (prevOrder === "asc" ? "desc" : "asc"));
        return prevField;
      }
      setSortOrder("asc");
      return field;
    });
  }, []);

  // Active table config
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = stats.pending?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byModel, pendingMap, sortBy, sortOrder), "rawModel"),
          storageKey: "usage-unified:expanded-models",
          emptyMessage: "Bisher kein Modell-Verbrauch im Zeitraum erfasst.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap = {};
        if (stats?.pending?.byAccount) {
          Object.entries(stats.byAccount || {}).forEach(([accountKey, data]) => {
            const connPending = stats.pending.byAccount[data.connectionId];
            if (connPending) {
              const modelKey = data.provider ? `${data.rawModel} (${data.provider})` : data.rawModel;
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byAccount, pendingMap, sortBy, sortOrder), "accountName"),
          storageKey: "usage-unified:expanded-accounts",
          emptyMessage: "Bisher kein Account-spezifischer Verbrauch erfasst.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}</td>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-unified:expanded-apikeys",
          emptyMessage: "Bisher kein API-Key Verbrauch erfasst.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium">{item.keyName}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byEndpoint, {}, sortBy, sortOrder), "endpoint"),
          storageKey: "usage-unified:expanded-endpoints",
          emptyMessage: "Bisher kein Endpoint-Verbrauch erfasst.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium font-mono text-sm">{item.endpoint}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  if (loading && !stats) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Top Header & Period Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500/20 via-primary/20 to-emerald-500/20 text-primary ring-1 ring-border">
              <span className="material-symbols-outlined text-[20px]">monitoring</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-text-main">
              Usage &amp; Analytics
            </h1>
            <span
              className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-400"
              title="SSE Live-Stream aktiv"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live Telemetrie
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Echtzeit-Durchsatz, Token-Verbrauch, Routing-Topologie und Kosten-Aufschlüsselung
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:self-auto">
          {/* Refresh action */}
          <button
            onClick={() => loadStats(true)}
            disabled={fetching}
            title="Daten neu laden"
            className="flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-2.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${fetching ? "animate-spin text-primary" : ""}`}>
              refresh
            </span>
          </button>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? "Auto-Refresh aktiv (15s)" : "Auto-Refresh pausiert"}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
              autoRefresh
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-surface text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {autoRefresh ? "sync" : "sync_disabled"}
            </span>
            <span>{autoRefresh ? "Auto (15s)" : "Pausiert"}</span>
          </button>

          {/* Period selector */}
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="md"
          />
        </div>
      </div>

      {/* Peak hours alert if active */}
      <PeakHoursBanner />

      {/* Main Tabs */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <SegmentedControl
          options={TABS}
          value={activeTab}
          onChange={handleTabChange}
          size="md"
          className="w-full sm:w-auto"
        />
      </div>

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-6">
          {/* Modern KPI Cards */}
          <OverviewCards stats={stats || {}} />

          {/* Live Activity Section: Topology + Recent Requests */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">hub</span>
                <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  Live Topologie &amp; Routing-Aktivität
                </span>
              </div>
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-text-muted">
                {stats?.activeRequests?.length || 0} Anfragen aktiv
              </span>
            </div>

            <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <ProviderTopology
                providers={providers}
                activeRequests={stats?.activeRequests || []}
                lastProvider={stats?.recentRequests?.[0]?.provider || ""}
                errorProvider={stats?.errorProvider || ""}
              />
              <RecentRequests requests={stats?.recentRequests || []} />
            </div>
          </section>

          {/* Bottom Grid: Model Health + Active Quotas */}
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
            <ModelHealthCard />
            <ActiveQuotas />
          </div>
        </div>
      )}

      {/* Tab: Analytics & Trends */}
      {activeTab === "analytics" && (
        <div className="flex flex-col gap-6">
          {/* Usage Chart */}
          <UsageChart period={period} />

          {/* Breakdown Table Section */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SegmentedControl
                options={TABLE_OPTIONS}
                value={tableView}
                onChange={setTableView}
                size="sm"
                className="w-full sm:w-auto"
              />
              <SegmentedControl
                options={VIEW_MODE_OPTIONS}
                value={viewMode}
                onChange={setViewMode}
                size="sm"
                className="w-full sm:w-auto"
              />
            </div>

            {activeTableConfig && (
              <UsageTable
                title=""
                columns={activeTableConfig.columns}
                groupedData={activeTableConfig.groupedData}
                tableType={tableView}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggleSort={toggleSort}
                viewMode={viewMode}
                storageKey={activeTableConfig.storageKey}
                renderSummaryCells={activeTableConfig.renderSummaryCells}
                renderDetailCells={activeTableConfig.renderDetailCells}
                emptyMessage={activeTableConfig.emptyMessage}
              />
            )}
          </section>
        </div>
      )}

      {/* Tab: Request Explorer */}
      {activeTab === "details" && <RequestDetailsTab />}

      {/* Tab: Quota Tracker */}
      {activeTab === "quota" && (
        <Suspense fallback={<CardSkeleton />}>
          <ProviderLimits />
        </Suspense>
      )}

      {/* Tab: Jev AI Router */}
      {activeTab === "jev" && (
        <div className="flex flex-col gap-6">
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
            <JevStatsCard period={period} />
            <JevChart period={period} />
          </div>
          <JevRequestLogCard />
        </div>
      )}
    </div>
  );
}
