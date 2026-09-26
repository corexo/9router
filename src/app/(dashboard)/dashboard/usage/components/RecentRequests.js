"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";

function fmt(n) {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Number(n).toLocaleString();
}

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 5) return "gerade";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{timeAgo(timestamp)}</>;
}

TimeAgo.propTypes = { timestamp: PropTypes.string };

export default function RecentRequests({ requests = [] }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="none" style={{ minHeight: 460 }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface-2/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">history</span>
          <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Live Stream
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-text-muted">
            {requests.length} Requests
          </span>
        </div>
      </div>

      {/* Content */}
      {!requests.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-muted">
          <span className="material-symbols-outlined text-[36px] opacity-40">wifi_tethering</span>
          <p className="text-sm font-medium">Keine aktuellen Requests</p>
          <p className="text-xs opacity-75">Warte auf eingehende Anfragen im Live-Stream...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ maxHeight: 400 }}>
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-surface/90 backdrop-blur-md">
              <tr className="border-b border-border-subtle text-text-muted">
                <th className="w-6 py-2 pl-3 text-left"></th>
                <th className="py-2 text-left font-semibold">Modell / Provider</th>
                <th className="py-2 text-right font-semibold whitespace-nowrap">In / Out</th>
                <th className="py-2 pr-3 text-right font-semibold">Zeit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/50">
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr
                    key={i}
                    className="group transition-colors hover:bg-surface-2/60"
                  >
                    <td className="py-2.5 pl-3">
                      <span
                        className={`block h-2 w-2 rounded-full ${
                          ok ? "bg-emerald-500 shadow-sm shadow-emerald-500/50" : "bg-red-500 shadow-sm shadow-red-500/50"
                        }`}
                        title={ok ? "Erfolgreich" : "Fehler"}
                      />
                    </td>
                    <td className="py-2.5 pr-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-mono text-[11px] font-semibold text-text-main" title={r.model}>
                          {r.model}
                        </span>
                        {r.provider && (
                          <span className="text-[10px] text-text-muted">
                            {r.provider}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-mono whitespace-nowrap">
                      <span className="text-primary font-medium">{fmt(r.promptTokens)}↑</span>
                      {" "}
                      <span className="text-emerald-500 font-medium">{fmt(r.completionTokens)}↓</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[11px] text-text-muted whitespace-nowrap">
                      <TimeAgo timestamp={r.timestamp} />
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

RecentRequests.propTypes = {
  requests: PropTypes.array,
};
