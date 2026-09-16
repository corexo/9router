"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";
import QuotaTable from "./ProviderLimits/QuotaTable";
import { parseQuotaData, getConnectionLabel } from "./ProviderLimits/utils";

// Compact overview widget: active quota state per connection, refreshed on demand.
// Full management (filters, hide rows, auto-refresh) lives in the Quota Tracker tab.
export default function ActiveQuotas() {
  const [items, setItems] = useState(null); // null = loading
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/providers/client?pageSize=500&sort=priority", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const connections = (data.connections || []).filter((c) => c.isActive !== false);
      const results = await Promise.all(
        connections.map(async (conn) => {
          try {
            const qr = await fetch(`/api/usage/${conn.id}`, { cache: "no-store" });
            if (!qr.ok) return null;
            const quotas = parseQuotaData(conn.provider, await qr.json());
            return quotas.length
              ? { id: conn.id, provider: conn.provider, name: getConnectionLabel(conn) || conn.provider, quotas }
              : null;
          } catch {
            return null;
          }
        }),
      );
      setItems(results.filter(Boolean));
    } catch {
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Active Quotas</span>
        <button
          onClick={fetchAll}
          disabled={refreshing}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-hover hover:text-text disabled:opacity-50"
          title="Refresh quotas"
        >
          <span className={`material-symbols-outlined text-[14px] ${refreshing ? "animate-spin" : ""}`}>refresh</span>
          Refresh
        </button>
      </div>

      {items === null ? (
        <Card padding="sm">
          <div className="flex items-center justify-center py-8 text-text-muted">
            <span className="material-symbols-outlined text-[28px] animate-spin">progress_activity</span>
          </div>
        </Card>
      ) : items.length === 0 ? (
        <Card padding="sm">
          <div className="py-6 text-center text-sm text-text-muted">No active quotas.</div>
        </Card>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} padding="sm" className="min-w-0">
              <div className="mb-1.5 flex items-center gap-2 border-b border-border pb-1.5">
                <ProviderIcon
                  src={`/providers/${item.provider}.png`}
                  alt={item.provider}
                  size={16}
                  className="size-4 rounded object-contain"
                  fallbackText={item.provider.slice(0, 2).toUpperCase()}
                />
                <span className="truncate text-xs font-medium">{item.name}</span>
              </div>
              <QuotaTable quotas={item.quotas} compact sortMode="default" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
