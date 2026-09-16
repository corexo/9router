"use client";

import { useEffect, useState } from "react";

function isActiveWindow(peak, h) {
  return peak.start <= peak.end
    ? h >= peak.start && h < peak.end
    : h >= peak.start || h < peak.end;
}

// Amber banner shown on the Usage page while any combo's peak-hours window is active.
export default function PeakHoursBanner() {
  const [active, setActive] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) return;
        const settings = await res.json();
        const strategies = settings.comboStrategies || {};
        const h = new Date().getHours();
        const list = Object.entries(strategies)
          .filter(([, s]) => s?.peakHours && isActiveWindow(s.peakHours, h))
          .map(([name, s]) => ({ name, ...s.peakHours }));
        if (!cancelled) setActive(list);
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

  if (!active.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
      <span className="material-symbols-outlined text-[18px]">schedule</span>
      <span className="min-w-0">
        <span className="font-semibold">Peak Hours active</span>
        {" — "}
        {active
          .map((a) => `${a.name}: keep ${a.percent}% (${a.start}:00–${a.end}:00)`)
          .join(" · ")}
      </span>
    </div>
  );
}
