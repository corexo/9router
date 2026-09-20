"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";

const STATE_STYLES = {
  disabled: "bg-red-500/10 text-red-500",
  incompatible: "bg-amber-500/10 text-amber-500",
  cooldown: "bg-sky-500/10 text-sky-500",
};

const REASON_LABELS = {
  unsupported: "Model not supported by provider",
  incompatible: "Request schema not supported",
  rate_limit: "Rate limited",
  temporary: "Upstream error",
};

function formatReset(expiresAt) {
  if (!expiresAt) return "manual reset";
  const diffSec = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (diffSec <= 0) return "expired";
  if (diffSec < 60) return `resets in ${diffSec}s`;
  return `resets in ${Math.ceil(diffSec / 60)}m`;
}

export default function ModelHealthCard() {
  const [entries, setEntries] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/model-health", { cache: "no-store" });
      if (res.ok) setEntries(await res.json());
    } catch (e) {
      console.error("Failed to fetch model health:", e);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  async function retest(id) {
    await fetch(`/api/model-health?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  if (entries.length === 0) return null;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Unavailable models</h3>
        <span className="text-xs text-text-muted">{entries.length} blocked</span>
      </div>

      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg-subtle p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{entry.id}</p>
              <p className="truncate text-xs text-text-muted">
                {REASON_LABELS[entry.reason] || entry.reason} · {entry.failures}x · {formatReset(entry.expiresAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-1 text-xs font-medium ${STATE_STYLES[entry.state] || "bg-bg-hover text-text-muted"}`}>
                {entry.state}
              </span>
              <button
                onClick={() => retest(entry.id)}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text"
              >
                Retest
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
