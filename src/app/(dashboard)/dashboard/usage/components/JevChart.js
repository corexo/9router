"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/shared/components/Card";

const VIEWS = [
  { value: "requests", label: "Requests" },
  { value: "credits", label: "Credits" },
  { value: "latency", label: "Latency" },
  { value: "models", label: "Models" },
];

export default function JevChart({ period = "7d" }) {
  const [stats, setStats] = useState(null);
  const [view, setView] = useState("requests");

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage/jev?period=${period}`, { cache: "no-store" });
      if (res.ok) setStats(await res.json());
    } catch (e) {
      console.error("Failed to fetch Jev stats:", e);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (!stats || stats.requests === 0) return null;

  const series = stats.series || [];
  const modelData = (stats.topChoices || []).map((choice) => ({ model: choice.model, count: choice.count }));

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Jev API Usage</h3>
        <div className="grid grid-cols-4 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              onClick={() => setView(option.value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${view === option.value ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {view === "models" ? (
            <BarChart data={modelData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="model" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Selected" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {view === "requests" && (
                <>
                  <Area type="monotone" dataKey="success" name="Success" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} />
                  <Area type="monotone" dataKey="fallbacks" name="Fallbacks" stroke="#ef4444" fill="#ef4444" fillOpacity={0.25} />
                </>
              )}
              {view === "credits" && (
                <Area type="monotone" dataKey="credits" name="Credits" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} />
              )}
              {view === "latency" && (
                <Area type="monotone" dataKey="avgLatencyMs" name="Avg latency (ms)" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.25} />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

JevChart.propTypes = {
  period: PropTypes.string,
};
