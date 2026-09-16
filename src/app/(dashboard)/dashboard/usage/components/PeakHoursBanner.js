"use client";

import { useEffect, useState } from "react";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function dayRangeLabel(days) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "daily";
  if (sorted.join(",") === "1,2,3,4,5") return "Mo–Fr";
  if (sorted.join(",") === "0,6") return "Sa–Su";
  return sorted.map((d) => DAY_LABELS[d]).join(",");
}

function isActiveWindow(peak, now) {
  const days = Array.isArray(peak.days) && peak.days.length > 0 ? peak.days : [1, 2, 3, 4, 5];
  if (!days.includes(now.getDay())) return false;
  const h = now.getHours();
  return peak.start <= peak.end
    ? h >= peak.start && h < peak.end
    : h >= peak.start || h < peak.end;
}

// Amber banner shown on the Usage page while the global peak-hours window is active.
export default function PeakHoursBanner() {
  const [peak, setPeak] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) return;
        const settings = await res.json();
        const config = settings.peakHours || null;
        if (!cancelled) setPeak(config && isActiveWindow(config, new Date()) ? config : null);
      } catch {
        // settings unavailable - banner stays hidden
      }
    };
    check();
    const timer = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!peak) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
      <span className="material-symbols-outlined text-[18px]">schedule</span>
      <span className="min-w-0">
        <span className="font-semibold">Peak Hours active</span>
        {" — "}
        {dayRangeLabel(peak.days)} {peak.start}:00–{peak.end}:00 · keeping{" "}
        {peak.percent}% claude/anthropic
      </span>
    </div>
  );
}
