"use client";

import { useEffect, useState } from "react";
import { Card, CardSkeleton } from "@/shared/components";

const WIDGETS = [
  {
    key: "providerFlow",
    label: "Provider Flow",
    desc: "Live diagram showing where requests are routed",
    icon: "hub",
  },
  {
    key: "recentRequests",
    label: "Recent Requests",
    desc: "Live feed of incoming requests on the Usage overview",
    icon: "receipt_long",
  },
  {
    key: "activeQuotas",
    label: "Active Quotas",
    desc: "Quota cards at the bottom of the Usage overview",
    icon: "data_usage",
  },
];

export default function WidgetsPage() {
  const [widgets, setWidgets] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((settings) => setWidgets(settings.widgets || {}))
      .catch(() => setWidgets({}));
  }, []);

  const toggle = async (key) => {
    if (!widgets) return;
    // Missing key = enabled, so unchecked state is stored as explicit false.
    const next = { ...widgets, [key]: widgets[key] === false };
    setWidgets(next);
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: next }),
      });
    } catch (error) {
      console.log("Error updating widgets:", error);
    } finally {
      setSaving(false);
    }
  };

  if (!widgets) {
    return (
      <div className="px-1 sm:px-0">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div>
        <h1 className="text-lg font-semibold">Widgets</h1>
        <p className="mt-1 text-sm text-text-muted">
          Choose which widgets appear on the Usage overview. Changes apply immediately.
          {saving && <span className="ml-2 text-primary">Saving…</span>}
        </p>
      </div>

      <Card padding="sm">
        <div className="flex flex-col">
          {WIDGETS.map((w) => (
            <label
              key={w.key}
              className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-1 py-3 last:border-0 last:pb-0"
            >
              <input
                type="checkbox"
                checked={widgets[w.key] !== false}
                onChange={() => toggle(w.key)}
              />
              <span className="material-symbols-outlined text-[18px] text-text-muted">{w.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{w.label}</span>
                <span className="block text-xs text-text-muted">{w.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}
