"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

export default function JevStatsCard({ period = "7d" }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/usage/jev?period=${period}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (!stats || stats.requests === 0) return null;

  const metrics = [
    { label: "Requests", value: stats.requests },
    { label: "Success", value: `${stats.successRate}%` },
    { label: "Fallbacks", value: stats.fallbacks },
    { label: "Credits", value: stats.credits.toFixed(6) },
    { label: "Tokens", value: stats.tokens.toLocaleString() },
    { label: "Avg latency", value: `${stats.avgLatencyMs} ms` },
  ];

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-[20px] text-violet-500">route</span>
        <h3 className="text-base font-semibold">Jev AI</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <p className="text-xs text-text-muted">{metric.label}</p>
            <p className="text-lg font-semibold">{metric.value}</p>
          </div>
        ))}
      </div>
      {stats.topChoices.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-text-muted mb-2">Selected models</p>
          <div className="flex flex-wrap gap-2">
            {stats.topChoices.map((choice) => (
              <span key={choice.model} className="text-xs px-2 py-1 rounded bg-violet-500/10 text-violet-500">
                {choice.model} x{choice.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
