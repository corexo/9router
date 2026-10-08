"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { Card, Badge, Toggle, Button } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";

const PROVIDER_METADATA = {
  claude: { name: "Claude", color: "#D97706", lightColor: "#F59E0B20", textColor: "text-amber-500", barColor: "bg-amber-500" },
  codex: { name: "Codex", color: "#10B981", lightColor: "#10B98120", textColor: "text-emerald-500", barColor: "bg-emerald-500" },
  glm: { name: "GLM", color: "#2563EB", lightColor: "#2563EB20", textColor: "text-blue-500", barColor: "bg-blue-500" },
  gemini: { name: "Gemini", color: "#8B5CF6", lightColor: "#8B5CF620", textColor: "text-purple-500", barColor: "bg-purple-500" },
  nvidia: { name: "NVIDIA", color: "#76B900", lightColor: "#76B90020", textColor: "text-lime-500", barColor: "bg-lime-500" },
  github: { name: "GitHub Models", color: "#64748B", lightColor: "#64748B20", textColor: "text-slate-400", barColor: "bg-slate-500" },
  ollama: { name: "Ollama", color: "#06B6D4", lightColor: "#06B6D420", textColor: "text-cyan-500", barColor: "bg-cyan-500" },
  "cloudflare-ai": { name: "Cloudflare AI", color: "#F97316", lightColor: "#F9731620", textColor: "text-orange-500", barColor: "bg-orange-500" },
  opencode: { name: "OpenCode", color: "#EC4899", lightColor: "#EC489920", textColor: "text-pink-500", barColor: "bg-pink-500" },
  openai: { name: "OpenAI", color: "#10A37F", lightColor: "#10A37F20", textColor: "text-emerald-600", barColor: "bg-emerald-600" },
  groq: { name: "Groq", color: "#F55036", lightColor: "#F5503620", textColor: "text-red-500", barColor: "bg-red-500" },
  mistral: { name: "Mistral", color: "#FF7000", lightColor: "#FF700020", textColor: "text-amber-600", barColor: "bg-amber-600" },
  deepseek: { name: "DeepSeek", color: "#4D6BFE", lightColor: "#4D6BFE20", textColor: "text-indigo-500", barColor: "bg-indigo-500" },
  xai: { name: "xAI", color: "#18181B", lightColor: "#18181B20", textColor: "text-zinc-400", barColor: "bg-zinc-700" },
};

const ACCOUNT_PALETTE = [
  "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#06B6D4", "#EC4899", "#14B8A6", "#F43F5E",
  "#6366F1", "#84CC16", "#EAB308", "#A855F7"
];

function getProviderMeta(providerId) {
  if (PROVIDER_METADATA[providerId]) return PROVIDER_METADATA[providerId];
  const name = providerId.charAt(0).toUpperCase() + providerId.slice(1);
  return {
    name,
    color: "#6B7280",
    lightColor: "#6B728020",
    textColor: "text-slate-400",
    barColor: "bg-slate-500",
  };
}

export default function DynamicTrafficBalancer({ accounts: initialAccounts, onAccountsUpdated }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSessions, setActiveSessions] = useState([]);
  const [balancerEnabled, setBalancerEnabled] = useState(true);
  const [accountBalanceEnabled, setAccountBalanceEnabled] = useState(false);
  const [providerConfig, setProviderConfig] = useState({});
  const [expandedProviders, setExpandedProviders] = useState({});
  const [saveStatus, setSaveStatus] = useState("idle"); // 'idle' | 'saving' | 'saved' | 'error'
  const debounceTimerRef = useRef(null);
  const accountDebounceRef = useRef({});
  const isInitialLoadRef = useRef(true);

  // Sync initialAccounts if passed
  useEffect(() => {
    if (Array.isArray(initialAccounts) && initialAccounts.length > 0) {
      queueMicrotask(() => setConnections((prev) => (prev.length === 0 ? initialAccounts : prev)));
    }
  }, [initialAccounts]);

  // Load configured providers from /api/providers and balancer config from /api/settings
  const loadData = useCallback(async () => {
    try {
      const [provRes, setRes] = await Promise.all([
        fetch("/api/providers").catch(() => null),
        fetch("/api/settings").catch(() => null),
      ]);

      let conns = Array.isArray(initialAccounts) && initialAccounts.length > 0 ? [...initialAccounts] : [];
      if (provRes && provRes.ok) {
        const json = await provRes.json();
        if (Array.isArray(json.connections) && json.connections.length > 0) {
          conns = json.connections;
        }
      }
      setConnections(conns);

      let existingBalancer = null;
      if (setRes && setRes.ok) {
        const sJson = await setRes.json();
        setAccountBalanceEnabled(sJson.accountBalanceEnabled === true);
        if (sJson.providerBalancer) {
          existingBalancer = sJson.providerBalancer;
          if (typeof existingBalancer.enabled === "boolean") {
            setBalancerEnabled(existingBalancer.enabled);
          }
        }
      }

      // Group providers from connections
      const pMap = {};
      conns.forEach((c) => {
        if (c.provider) {
          pMap[c.provider] = (pMap[c.provider] || 0) + (c.isActive !== false ? 1 : 0);
        }
      });

      const initialConfig = {};
      const activeProviderKeys = Object.keys(pMap).filter((p) => pMap[p] > 0);

      // Populate from existing settings or generate sensible defaults
      if (existingBalancer && existingBalancer.providers && Object.keys(existingBalancer.providers).length > 0) {
        const merged = { ...existingBalancer.providers };
        activeProviderKeys.forEach((p) => {
          if (!merged[p]) {
            merged[p] = { enabled: false, weight: 50 };
          }
        });
        setProviderConfig(merged);
      } else {
        const defaultEnabled = activeProviderKeys.slice(0, 2);
        activeProviderKeys.forEach((p) => {
          const isSelected = defaultEnabled.includes(p);
          initialConfig[p] = {
            enabled: isSelected,
            weight: isSelected ? 50 : 0,
          };
        });
        setProviderConfig(initialConfig);
      }

      // Auto-expand providers with > 1 account by default
      const defaultExpanded = {};
      conns.forEach((c) => {
        if (c.provider && (pMap[c.provider] || 0) > 1) {
          defaultExpanded[c.provider] = true;
        }
      });
      setExpandedProviders(defaultExpanded);
    } catch (err) {
      console.error("[DynamicTrafficBalancer] Load error:", err);
    } finally {
      setLoading(false);
      setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 500);
    }
  }, [initialAccounts]);

  // Fetch active session cache data
  const loadActiveSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/cache-sessions?filter=active");
      if (res.ok) {
        const json = await res.json();
        setActiveSessions(json.sessions || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      loadData();
      loadActiveSessions();
    });
    const timer = setInterval(loadActiveSessions, 10000);
    return () => clearInterval(timer);
  }, [loadData, loadActiveSessions]);

  // Aggregate providers list
  const providersList = useMemo(() => {
    const map = new Map();
    connections.forEach((c) => {
      const p = c.provider;
      if (!map.has(p)) {
        map.set(p, {
          id: p,
          ...getProviderMeta(p),
          totalAccounts: 0,
          activeAccounts: 0,
        });
      }
      const entry = map.get(p);
      entry.totalAccounts += 1;
      if (c.isActive !== false) entry.activeAccounts += 1;
    });

    Object.keys(providerConfig).forEach((p) => {
      if (!map.has(p)) {
        map.set(p, {
          id: p,
          ...getProviderMeta(p),
          totalAccounts: 0,
          activeAccounts: 0,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const aIn = providerConfig[a.id]?.enabled ? 1 : 0;
      const bIn = providerConfig[b.id]?.enabled ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn;
      return b.activeAccounts - a.activeAccounts;
    });
  }, [connections, providerConfig]);

  // Count pinned sessions per provider and per connection
  const { sessionsByProvider, sessionsByConnection } = useMemo(() => {
    const byP = {};
    const byC = {};
    activeSessions.forEach((s) => {
      const p = s.provider || (s.model ? s.model.split("/")[0] : null);
      if (p) byP[p] = (byP[p] || 0) + 1;
      if (s.connectionId) byC[s.connectionId] = (byC[s.connectionId] || 0) + 1;
    });
    return { sessionsByProvider: byP, sessionsByConnection: byC };
  }, [activeSessions]);

  // Enabled providers in balancer
  const enabledProviders = useMemo(() => {
    return providersList.filter((p) => providerConfig[p.id]?.enabled);
  }, [providersList, providerConfig]);

  // Calculate normalized percentages for providers
  const distributionShares = useMemo(() => {
    if (enabledProviders.length === 0) return {};
    const totalWeight = enabledProviders.reduce((sum, p) => {
      const w = Number(providerConfig[p.id]?.weight) || 0;
      return sum + Math.max(0, w);
    }, 0);

    const shares = {};
    if (totalWeight === 0) {
      const equal = (100 / enabledProviders.length).toFixed(1);
      enabledProviders.forEach((p) => { shares[p.id] = Number(equal); });
    } else {
      enabledProviders.forEach((p) => {
        const w = Number(providerConfig[p.id]?.weight) || 0;
        shares[p.id] = Number(((Math.max(0, w) / totalWeight) * 100).toFixed(1));
      });
    }
    return shares;
  }, [enabledProviders, providerConfig]);

  // Auto-save changes to /api/settings (debounced)
  const persistBalancerSettings = useCallback((newEnabled, newConfig) => {
    if (!accountBalanceEnabled || isInitialLoadRef.current) return;
    setSaveStatus("saving");

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerBalancer: {
              enabled: newEnabled,
              providers: newConfig,
            },
          }),
        });

        if (res.ok) {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2500);
          if (onAccountsUpdated) onAccountsUpdated();
        } else {
          setSaveStatus("error");
        }
      } catch (err) {
        console.error("[DynamicTrafficBalancer] Save failed:", err);
        setSaveStatus("error");
      }
    }, 400);
  }, [accountBalanceEnabled, onAccountsUpdated]);

  // Auto-save changes to individual accounts via PUT /api/providers/[id]
  const saveAccountUpdate = useCallback((connId, patch) => {
    if (!accountBalanceEnabled) return;
    setSaveStatus("saving");
    if (accountDebounceRef.current[connId]) {
      clearTimeout(accountDebounceRef.current[connId]);
    }
    accountDebounceRef.current[connId] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/providers/${connId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
          if (onAccountsUpdated) onAccountsUpdated();
        } else {
          setSaveStatus("error");
        }
      } catch (err) {
        console.error("[DynamicTrafficBalancer] Account save failed:", err);
        setSaveStatus("error");
      }
    }, 350);
  }, [accountBalanceEnabled, onAccountsUpdated]);

  // Toggle master balancer switch
  const handleToggleMaster = (val) => {
    if (!accountBalanceEnabled) return;
    setBalancerEnabled(val);
    persistBalancerSettings(val, providerConfig);
  };

  // Toggle single provider in/out of balancer
  const handleToggleProvider = (providerId) => {
    const current = !!providerConfig[providerId]?.enabled;
    const currentWeight = providerConfig[providerId]?.weight !== undefined ? providerConfig[providerId].weight : 50;
    const nextConfig = {
      ...providerConfig,
      [providerId]: {
        enabled: !current,
        weight: !current && currentWeight === 0 ? 50 : currentWeight,
      },
    };
    setProviderConfig(nextConfig);
    persistBalancerSettings(balancerEnabled, nextConfig);
  };

  // Change individual provider weight
  const handleWeightChange = (providerId, newWeight) => {
    const clamped = Math.max(0, Math.min(100, Number(newWeight) || 0));
    const nextConfig = {
      ...providerConfig,
      [providerId]: {
        ...(providerConfig[providerId] || { enabled: true }),
        weight: clamped,
      },
    };
    setProviderConfig(nextConfig);
    persistBalancerSettings(balancerEnabled, nextConfig);
  };

  // 2-Way Crossfader Slider for Providers
  const handleCrossfaderChange = (sliderVal) => {
    if (enabledProviders.length !== 2) return;
    const [pA, pB] = enabledProviders;
    const weightA = Math.max(0, Math.min(100, Math.round(sliderVal)));
    const weightB = 100 - weightA;

    const nextConfig = {
      ...providerConfig,
      [pA.id]: { ...(providerConfig[pA.id] || {}), enabled: true, weight: weightA },
      [pB.id]: { ...(providerConfig[pB.id] || {}), enabled: true, weight: weightB },
    };
    setProviderConfig(nextConfig);
    persistBalancerSettings(balancerEnabled, nextConfig);
  };

  const handleApplyPreset = (ratioA, ratioB) => {
    if (enabledProviders.length !== 2) return;
    const [pA, pB] = enabledProviders;
    const nextConfig = {
      ...providerConfig,
      [pA.id]: { ...(providerConfig[pA.id] || {}), enabled: true, weight: ratioA },
      [pB.id]: { ...(providerConfig[pB.id] || {}), enabled: true, weight: ratioB },
    };
    setProviderConfig(nextConfig);
    persistBalancerSettings(balancerEnabled, nextConfig);
  };

  const handleEqualize = () => {
    if (enabledProviders.length === 0) return;
    const equalWeight = Math.round(100 / enabledProviders.length);
    const nextConfig = { ...providerConfig };
    enabledProviders.forEach((p) => {
      nextConfig[p.id] = {
        ...(nextConfig[p.id] || {}),
        enabled: true,
        weight: equalWeight,
      };
    });
    setProviderConfig(nextConfig);
    persistBalancerSettings(balancerEnabled, nextConfig);
  };

  // Account-level handlers
  const handleAccountToggle = (connId) => {
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;
    const nextEnabled = !conn.dynamicBalanceEnabled;
    const nextWeight = conn.weight !== undefined && conn.weight !== null ? conn.weight : 50;
    const finalWeight = nextEnabled && nextWeight === 0 ? 50 : nextWeight;

    setConnections((prev) =>
      prev.map((c) => (c.id === connId ? { ...c, dynamicBalanceEnabled: nextEnabled, weight: finalWeight } : c))
    );
    saveAccountUpdate(connId, { dynamicBalanceEnabled: nextEnabled, weight: finalWeight });
  };

  const handleAccountWeightChange = (connId, newWeight) => {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(newWeight) || 0)));
    setConnections((prev) =>
      prev.map((c) => (c.id === connId ? { ...c, weight: clamped, dynamicBalanceEnabled: true } : c))
    );
    saveAccountUpdate(connId, { weight: clamped, dynamicBalanceEnabled: true });
  };

  const handleAccountEqualize = (providerId) => {
    const providerConns = connections.filter((c) => c.provider === providerId && c.isActive !== false);
    if (providerConns.length === 0) return;
    const equalWeight = Math.round(100 / providerConns.length);
    setConnections((prev) =>
      prev.map((c) => {
        if (c.provider === providerId && c.isActive !== false) {
          return { ...c, weight: equalWeight, dynamicBalanceEnabled: true };
        }
        return c;
      })
    );
    providerConns.forEach((c) => {
      saveAccountUpdate(c.id, { weight: equalWeight, dynamicBalanceEnabled: true });
    });
  };

  const handleAccountCrossfaderChange = (connAId, connBId, val) => {
    const weightA = Math.max(0, Math.min(100, Math.round(val)));
    const weightB = 100 - weightA;
    setConnections((prev) =>
      prev.map((c) => {
        if (c.id === connAId) return { ...c, weight: weightA, dynamicBalanceEnabled: true };
        if (c.id === connBId) return { ...c, weight: weightB, dynamicBalanceEnabled: true };
        return c;
      })
    );
    saveAccountUpdate(connAId, { weight: weightA, dynamicBalanceEnabled: true });
    saveAccountUpdate(connBId, { weight: weightB, dynamicBalanceEnabled: true });
  };

  // Helper to compute account percentage shares for a specific provider
  const getAccountShares = useCallback((providerId) => {
    const pConns = connections.filter(
      (c) => c.provider === providerId && c.dynamicBalanceEnabled === true && c.isActive !== false
    );
    if (pConns.length === 0) return {};
    const total = pConns.reduce((sum, c) => {
      const w = c.weight !== undefined && c.weight !== null ? Number(c.weight) : 50;
      return sum + Math.max(0, w);
    }, 0);
    const shares = {};
    if (total === 0) {
      const eq = 100 / pConns.length;
      pConns.forEach((c) => { shares[c.id] = Number(eq.toFixed(1)); });
    } else {
      pConns.forEach((c) => {
        const w = c.weight !== undefined && c.weight !== null ? Number(c.weight) : 50;
        shares[c.id] = Number(((Math.max(0, w) / total) * 100).toFixed(1));
      });
    }
    return shares;
  }, [connections]);

  const toggleExpandProvider = (pId) => {
    setExpandedProviders((prev) => ({ ...prev, [pId]: !prev[pId] }));
  };

  if (loading) {
    return (
      <Card className="animate-pulse p-6">
        <div className="h-6 w-48 bg-surface-2 rounded mb-4" />
        <div className="h-4 w-72 bg-surface-2 rounded mb-6" />
        <div className="h-10 w-full bg-surface-2 rounded" />
      </Card>
    );
  }

  const isTwoProviderMode = enabledProviders.length === 2;
  const pA = isTwoProviderMode ? enabledProviders[0] : null;
  const pB = isTwoProviderMode ? enabledProviders[1] : null;
  const crossfaderValue = isTwoProviderMode && pA
    ? (distributionShares[pA.id] !== undefined ? Math.round(distributionShares[pA.id]) : 50)
    : 50;

  return (
    <Card padding="none" className="overflow-hidden border border-border/70 shadow-sm">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-border bg-surface-2/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary mt-0.5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-semibold text-text-main">
                Multi-Provider Traffic-Balancer
              </h2>
              <Badge variant={!accountBalanceEnabled ? "neutral" : balancerEnabled ? "success" : "neutral"} size="sm">
                {!accountBalanceEnabled ? "Deaktiviert" : balancerEnabled ? "Aktiv" : "Pausiert"}
              </Badge>
              {saveStatus === "saving" && (
                <span className="text-xs text-amber-500 flex items-center gap-1 font-mono">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                  Speichert...
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="text-xs text-emerald-500 font-mono flex items-center gap-0.5">
                  ✓ Gespeichert
                </span>
              )}
              {saveStatus === "error" && (
                <span className="text-xs text-rose-500 font-mono">
                  ⚠ Speicherfehler
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-text-muted mt-0.5">
              Dynamische Lastverteilung zwischen ausgewählten KI-Anbietern &amp; Konten. Laufende Chats bleiben über Session-Stickiness zu 100% beim selben Modell (voller Prompt-Cache-Erhalt).
            </p>
            {!accountBalanceEnabled && <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400" role="status">Account Balance deaktiviert. Konfiguration und Historie bleiben gespeichert; die Verteilung ist pausiert.</p>}
            {!accountBalanceEnabled && <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400" role="status">Account Balance deaktiviert. Gespeicherte Gewichtungen bleiben erhalten; die Verteilung ist pausiert.</p>}
          </div>
        </div>

        {/* Master On/Off Switch */}
        <div className="flex items-center gap-3 self-end sm:self-center bg-surface-2 px-3.5 py-2 rounded-xl border border-border/60">
          <span className="text-xs font-medium text-text-main">
            {!accountBalanceEnabled ? "Systemweit deaktiviert" : `Balancer ${balancerEnabled ? "Eingeschaltet" : "Ausgeschaltet"}`}
          </span>
          <Toggle
            checked={balancerEnabled}
            onChange={handleToggleMaster}
            disabled={!accountBalanceEnabled}
          />
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6" inert={!accountBalanceEnabled ? "" : undefined} aria-disabled={!accountBalanceEnabled}>
        {/* Master Segmented Distribution Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-text-main flex items-center gap-2">
              <span>Traffic-Aufteilung (Neue Sessions)</span>
              <span className="font-mono text-text-muted font-normal">
                ({enabledProviders.length} von {providersList.length} Anbietern aktiv)
              </span>
            </span>
            <div className="flex items-center gap-2">
              {enabledProviders.length > 1 && (
                <button
                  onClick={handleEqualize}
                  className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  Anbieter gleichmäßig verteilen
                </button>
              )}
            </div>
          </div>

          {/* Segmented Progress Bar */}
          {enabledProviders.length > 0 ? (
            <div className="h-4 w-full bg-surface-2 rounded-full overflow-hidden flex p-0.5 border border-border/80 shadow-inner">
              {enabledProviders.map((p) => {
                const share = distributionShares[p.id] || 0;
                if (share <= 0) return null;
                return (
                  <div
                    key={p.id}
                    style={{
                      width: `${share}%`,
                      backgroundColor: p.color,
                    }}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300 relative group cursor-pointer"
                    title={`${p.name}: ${share}% Traffic`}
                  />
                );
              })}
            </div>
          ) : (
            <div className="h-4 w-full bg-surface-2 rounded-full border border-dashed border-border flex items-center justify-center text-[10px] text-text-muted">
              Kein Anbieter im Balancer ausgewählt (Standard-Routing)
            </div>
          )}

          {/* Distribution Legend Pills */}
          {enabledProviders.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {enabledProviders.map((p) => {
                const share = distributionShares[p.id] || 0;
                return (
                  <div
                    key={p.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs"
                    style={{
                      borderColor: `${p.color}40`,
                      backgroundColor: `${p.color}12`,
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="font-medium text-text-main">{p.name}</span>
                    <span className="font-mono font-bold ml-1" style={{ color: p.color }}>
                      {share}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* INTERACTIVE 2-WAY CROSSFADER (When exactly 2 providers are selected) */}
        {isTwoProviderMode && pA && pB && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-surface-2/60 to-surface-2/20 border border-border/80 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary" />
                Live 2-Wege Provider-Crossfader
              </span>
              <span className="text-xs text-text-muted font-mono">
                Schieberegler verschieben für dynamische Verteilung
              </span>
            </div>

            {/* Crossfader Visual Card */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              {/* Left Provider (A) */}
              <div
                className="md:col-span-3 p-3 rounded-xl border flex items-center justify-between"
                style={{
                  borderColor: `${pA.color}40`,
                  backgroundColor: `${pA.color}10`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <ProviderIcon providerId={pA.id} size={28} />
                  <div>
                    <div className="font-semibold text-text-main text-sm">{pA.name}</div>
                    <div className="text-[11px] text-text-muted">
                      {pA.activeAccounts} Konten aktiv
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold font-mono" style={{ color: pA.color }}>
                    {crossfaderValue}%
                  </div>
                </div>
              </div>

              {/* Center Slider */}
              <div className="md:col-span-6 px-2 space-y-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={crossfaderValue}
                  onChange={(e) => handleCrossfaderChange(Number(e.target.value))}
                  className="w-full h-3 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-primary border border-border"
                />
                <div className="flex justify-between text-[11px] font-mono text-text-muted px-1">
                  <span>← 100% {pA.name}</span>
                  <span>50 / 50</span>
                  <span>100% {pB.name} →</span>
                </div>
              </div>

              {/* Right Provider (B) */}
              <div
                className="md:col-span-3 p-3 rounded-xl border flex items-center justify-between"
                style={{
                  borderColor: `${pB.color}40`,
                  backgroundColor: `${pB.color}10`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <ProviderIcon providerId={pB.id} size={28} />
                  <div>
                    <div className="font-semibold text-text-main text-sm">{pB.name}</div>
                    <div className="text-[11px] text-text-muted">
                      {pB.activeAccounts} Konten aktiv
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold font-mono" style={{ color: pB.color }}>
                    {100 - crossfaderValue}%
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Ratio Presets */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-border/50">
              <span className="text-xs text-text-muted mr-1">Schnell-Verhältnisse:</span>
              {[
                { label: "50 : 50 (Gleich)", a: 50, b: 50 },
                { label: "60 : 40", a: 60, b: 40 },
                { label: "70 : 30", a: 70, b: 30 },
                { label: "80 : 20", a: 80, b: 20 },
                { label: "90 : 10", a: 90, b: 10 },
              ].map((preset) => {
                const isActive = crossfaderValue === preset.a;
                return (
                  <button
                    key={preset.label}
                    onClick={() => handleApplyPreset(preset.a, preset.b)}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                      isActive
                        ? "bg-primary text-white shadow-sm"
                        : "bg-surface-2 hover:bg-surface border border-border/60 text-text-main"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button
                onClick={() => handleApplyPreset(100 - crossfaderValue, crossfaderValue)}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-surface-2 hover:bg-surface border border-border/60 text-text-main transition-colors flex items-center gap-1"
                title="Anteile tauschen"
              >
                <span>⇄</span> Tauschen
              </button>
            </div>
          </div>
        )}

        {/* PROVIDER CARDS LIST / GRID */}
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span className="font-semibold uppercase tracking-wider">
              KI-Anbieter ({providersList.length}) &amp; Konten-Steuerung
            </span>
            <span>Häkchen setzen für Provider- &amp; Account-Gewichtung</span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {providersList.map((provider) => {
              const cfg = providerConfig[provider.id] || { enabled: false, weight: 50 };
              const isIncluded = cfg.enabled === true;
              const weight = cfg.weight !== undefined ? cfg.weight : 50;
              const share = distributionShares[provider.id] || 0;
              const sessionCount = sessionsByProvider[provider.id] || 0;

              // Accounts of this provider
              const providerAccounts = connections.filter((c) => c.provider === provider.id);
              const isExpanded = expandedProviders[provider.id] ?? (providerAccounts.length > 1);

              // Account shares under this provider
              const accountShares = getAccountShares(provider.id);
              const enabledAccounts = providerAccounts.filter(
                (c) => c.dynamicBalanceEnabled === true && c.isActive !== false
              );
              const isTwoAccountMode = enabledAccounts.length === 2;
              const accA = isTwoAccountMode ? enabledAccounts[0] : null;
              const accB = isTwoAccountMode ? enabledAccounts[1] : null;
              const accCrossfaderVal = isTwoAccountMode && accA
                ? (accountShares[accA.id] !== undefined ? Math.round(accountShares[accA.id]) : 50)
                : 50;

              return (
                <div
                  key={provider.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                    isIncluded
                      ? "bg-surface border-border shadow-sm ring-1 ring-border/50"
                      : "bg-surface-2/30 border-border/50 opacity-70 hover:opacity-95"
                  }`}
                >
                  {/* Top: Provider Overview & Balancer Toggle */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={() => handleToggleProvider(provider.id)}
                        className="w-4 h-4 rounded text-primary focus:ring-primary/30 border-border cursor-pointer"
                        id={`check-${provider.id}`}
                      />
                      <label htmlFor={`check-${provider.id}`} className="flex items-center gap-2.5 cursor-pointer">
                        <ProviderIcon providerId={provider.id} size={30} />
                        <div>
                          <div className="font-semibold text-text-main text-base flex items-center gap-2">
                            <span>{provider.name}</span>
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: provider.color }}
                            />
                            <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted font-normal">
                              {provider.activeAccounts} von {provider.totalAccounts} Konten aktiv
                            </span>
                          </div>
                          {sessionCount > 0 && (
                            <div className="text-[11px] text-emerald-500 font-mono mt-0.5">
                              • {sessionCount} aktive Sessions (Stickiness Cache)
                            </div>
                          )}
                        </div>
                      </label>
                    </div>

                    {/* Share / Status Badge */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {isIncluded ? (
                        <div
                          className="px-3 py-1 rounded-lg text-xs font-mono font-bold border"
                          style={{
                            borderColor: `${provider.color}50`,
                            backgroundColor: `${provider.color}15`,
                            color: provider.color,
                          }}
                        >
                          {share}% Provider-Traffic
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted bg-surface-2 px-2.5 py-1 rounded-lg border border-border/60">
                          Provider Inaktiv (Fallback)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Provider Weight Slider */}
                  {isIncluded && (
                    <div className="mt-4 pt-3 border-t border-border/50 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-muted font-medium">Provider-Gewichtung (Relativer Anteil am Gesamttraffic):</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleWeightChange(provider.id, weight - 5)}
                            className="w-6 h-6 rounded bg-surface-2 hover:bg-surface border border-border text-text-main font-bold flex items-center justify-center text-xs"
                            title="-5%"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={weight}
                            onChange={(e) => handleWeightChange(provider.id, e.target.value)}
                            className="w-14 px-1.5 py-0.5 rounded bg-surface-2 border border-border text-center font-mono text-xs font-bold text-text-main"
                          />
                          <button
                            onClick={() => handleWeightChange(provider.id, weight + 5)}
                            className="w-6 h-6 rounded bg-surface-2 hover:bg-surface border border-border text-text-main font-bold flex items-center justify-center text-xs"
                            title="+5%"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={weight}
                        onChange={(e) => handleWeightChange(provider.id, e.target.value)}
                        className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer border border-border/60"
                        style={{ accentColor: provider.color }}
                      />
                    </div>
                  )}

                  {/* SUB-LEVEL: ACCOUNTS DISTRIBUTION UNDER THIS PROVIDER */}
                  {providerAccounts.length > 0 && (
                    <div className="mt-5 pt-4 border-t border-border/60 bg-surface-2/20 -mx-4 -mb-4 sm:-mx-5 sm:-mb-5 p-4 sm:p-5 rounded-b-2xl space-y-3.5">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => toggleExpandProvider(provider.id)}
                          className="flex items-center gap-2 text-xs font-semibold text-text-main hover:text-primary transition-colors cursor-pointer"
                        >
                          <span className="text-[11px] text-text-muted">{isExpanded ? "▼" : "▶"}</span>
                          <span>Konten-Verteilung für {provider.name}</span>
                          <span className="font-mono text-text-muted font-normal">
                            ({providerAccounts.length} Konten, {enabledAccounts.length} im Balancer)
                          </span>
                        </button>

                        {isExpanded && providerAccounts.length > 1 && (
                          <button
                            onClick={() => handleAccountEqualize(provider.id)}
                            className="text-[11px] text-primary hover:text-primary/80 font-medium transition-colors"
                          >
                            Konten gleichmäßig aufteilen
                          </button>
                        )}
                      </div>

                      {/* Expandable Account Content */}
                      {isExpanded && (
                        <div className="space-y-3 pt-1">
                          {/* Mini Account Distribution Bar */}
                          {enabledAccounts.length > 0 && (
                            <div className="space-y-1.5 pb-2">
                              <div className="h-2.5 w-full bg-surface rounded-full overflow-hidden flex p-0.5 border border-border shadow-inner">
                                {enabledAccounts.map((acc, idx) => {
                                  const accShare = accountShares[acc.id] || 0;
                                  if (accShare <= 0) return null;
                                  const accColor = ACCOUNT_PALETTE[idx % ACCOUNT_PALETTE.length];
                                  return (
                                    <div
                                      key={acc.id}
                                      style={{
                                        width: `${accShare}%`,
                                        backgroundColor: accColor,
                                      }}
                                      className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
                                      title={`${acc.name || acc.id}: ${accShare}% von ${provider.name}`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* 2-Way Crossfader for Accounts (when exactly 2 accounts are enabled under this provider) */}
                          {isTwoAccountMode && accA && accB && (
                            <div className="p-3 rounded-xl bg-surface border border-border/80 space-y-2.5">
                              <div className="flex items-center justify-between text-[11px] text-text-muted">
                                <span className="font-medium font-mono text-text-main truncate max-w-[140px]">
                                  {accA.name || accA.id?.slice(0, 10)} ({accCrossfaderVal}%)
                                </span>
                                <span className="text-[10px] text-primary">2-Wege Konten-Crossfader</span>
                                <span className="font-medium font-mono text-text-main truncate max-w-[140px]">
                                  {accB.name || accB.id?.slice(0, 10)} ({100 - accCrossfaderVal}%)
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={accCrossfaderVal}
                                onChange={(e) =>
                                  handleAccountCrossfaderChange(accA.id, accB.id, Number(e.target.value))
                                }
                                className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-primary border border-border"
                              />
                            </div>
                          )}

                          {/* Account Rows */}
                          <div className="space-y-2">
                            {providerAccounts.map((acc, idx) => {
                              const isAccEnabled = acc.dynamicBalanceEnabled === true;
                              const accWeight = acc.weight !== undefined && acc.weight !== null ? acc.weight : 50;
                              const accShare = accountShares[acc.id] || 0;
                              const accColor = ACCOUNT_PALETTE[idx % ACCOUNT_PALETTE.length];
                              const accSessionCount = sessionsByConnection[acc.id] || 0;

                              return (
                                <div
                                  key={acc.id}
                                  className={`p-3 rounded-xl border transition-all ${
                                    isAccEnabled
                                      ? "bg-surface border-border shadow-xs"
                                      : "bg-surface-2/40 border-border/40 opacity-70 hover:opacity-90"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2.5">
                                    <div className="flex items-center gap-2.5">
                                      <input
                                        type="checkbox"
                                        checked={isAccEnabled}
                                        onChange={() => handleAccountToggle(acc.id)}
                                        className="w-3.5 h-3.5 rounded text-primary focus:ring-primary/30 border-border cursor-pointer"
                                        id={`acc-check-${acc.id}`}
                                      />
                                      <label
                                        htmlFor={`acc-check-${acc.id}`}
                                        className="cursor-pointer flex items-center gap-2"
                                      >
                                        <span
                                          className="w-2.5 h-2.5 rounded-full shrink-0"
                                          style={{ backgroundColor: accColor }}
                                        />
                                        <div>
                                          <div className="font-semibold text-text-main text-xs flex items-center gap-1.5">
                                            <span>{acc.name || "Unbenanntes Konto"}</span>
                                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-2 border border-border text-text-muted font-mono uppercase">
                                              {acc.authType || "oauth"}
                                            </span>
                                            {accSessionCount > 0 && (
                                              <span className="text-[10px] text-emerald-500 font-mono">
                                                • {accSessionCount} Sessions
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[10px] text-text-muted font-mono truncate max-w-[200px]">
                                            {acc.id}
                                          </div>
                                        </div>
                                      </label>
                                    </div>

                                    {/* Account Share Badge */}
                                    <div>
                                      {isAccEnabled ? (
                                        <span
                                          className="px-2 py-0.5 rounded text-[11px] font-mono font-bold border"
                                          style={{
                                            borderColor: `${accColor}50`,
                                            backgroundColor: `${accColor}15`,
                                            color: accColor,
                                          }}
                                        >
                                          {accShare}% von {provider.name}
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-text-muted bg-surface-2 px-1.5 py-0.5 rounded border border-border/50">
                                          Pausiert
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Account Slider */}
                                  {isAccEnabled && (
                                    <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center gap-3">
                                      <span className="text-[11px] text-text-muted shrink-0">Gewicht:</span>
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={accWeight}
                                        onChange={(e) => handleAccountWeightChange(acc.id, e.target.value)}
                                        className="w-full h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer border border-border/60"
                                        style={{ accentColor: accColor }}
                                      />
                                      <div className="flex items-center gap-1 shrink-0">
                                        <input
                                          type="number"
                                          min="0"
                                          max="100"
                                          value={accWeight}
                                          onChange={(e) => handleAccountWeightChange(acc.id, e.target.value)}
                                          className="w-11 px-1 py-0.5 rounded bg-surface-2 border border-border text-center font-mono text-[11px] font-bold text-text-main"
                                        />
                                        <span className="text-[10px] text-text-muted font-mono">%</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Cache Invariant Information Note */}
        <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-text-main flex items-start gap-2.5">
          <span className="text-blue-500 text-base leading-none shrink-0 mt-0.5">ℹ️</span>
          <div>
            <span className="font-semibold text-blue-500">Zweistufiges Balancing &amp; Cache-Garantie:</span>{" "}
            Zuerst steuern die Provider-Gewichte, welcher KI-Anbieter für <strong>neue</strong> Chats gewählt wird. Innerhalb des gewählten Anbieters steuern die Konten-Gewichte die Auswahl des konkreten Kontos. Laufende Chats bleiben dank Session-Stickiness zu 100% beim selben Konto und Modell (voller Prompt-Cache-Erhalt).
          </div>
        </div>
      </div>
    </Card>
  );
}

DynamicTrafficBalancer.propTypes = {
  accounts: PropTypes.array,
  onAccountsUpdated: PropTypes.func,
};
