"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

export default function UsageChart({ period = "7d" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      {/* Header & Mode Switch */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[18px]">trending_up</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-main">
              {viewMode === "tokens" ? "Token-Verlauf" : "Kosten-Verlauf"}
            </h3>
            <p className="text-xs text-text-muted">
              {viewMode === "tokens"
                ? "Echtzeit-Durchsatz von Prompt- & Completion-Tokens"
                : "Geschätzte Upstream-Provider-Kosten im Zeitraum"}
            </p>
          </div>
        </div>

        <div className="inline-flex items-center rounded-lg border border-border bg-surface-2 p-1">
          <button
            onClick={() => setViewMode("tokens")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              viewMode === "tokens"
                ? "bg-surface text-primary shadow-sm"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">data_usage</span>
            Tokens
          </button>
          <button
            onClick={() => setViewMode("cost")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              viewMode === "cost"
                ? "bg-surface text-amber-500 shadow-sm"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">payments</span>
            Kosten ($)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center text-text-muted text-sm">
          <span className="material-symbols-outlined mr-2 animate-spin text-[20px]">progress_activity</span>
          Lade Trend-Daten...
        </div>
      ) : !hasData ? (
        <div className="flex h-56 flex-col items-center justify-center gap-1 text-text-muted text-sm">
          <span className="material-symbols-outlined text-[28px] opacity-40">show_chart</span>
          <span>Keine Verbrauchsdaten für den Zeitraum</span>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-text-muted, #888)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-text-muted, #888)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCost}
                width={55}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-surface, #1e1e2d)",
                  borderColor: "var(--color-border, #333)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                }}
                formatter={(value, name) =>
                  name === "tokens"
                    ? [Number(value).toLocaleString() + " Tokens", "Durchsatz"]
                    : [fmtCost(value), "Kosten"]
                }
              />
              {viewMode === "tokens" ? (
                <Area
                  type="monotone"
                  dataKey="tokens"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fill="url(#gradTokens)"
                  dot={false}
                  activeDot={{ r: 5, fill: "#6366f1" }}
                />
              ) : (
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  fill="url(#gradCost)"
                  dot={false}
                  activeDot={{ r: 5, fill: "#f59e0b" }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
