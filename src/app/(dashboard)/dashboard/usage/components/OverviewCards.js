"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

function fmtTokens(n) {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Number(n).toLocaleString();
}

function fmtCost(n) {
  if (n == null || isNaN(n)) return "$0.00";
  return `$${Number(n).toFixed(2)}`;
}

export default function OverviewCards({ stats = {} }) {
  const totalPrompt = stats.totalPromptTokens || 0;
  const totalCompletion = stats.totalCompletionTokens || 0;
  const totalCached = stats.totalCachedTokens || 0;
  const totalRequests = stats.totalRequests || 0;
  const totalCost = stats.totalCost || 0;
  const activeCount = stats.activeRequests?.length || 0;
  const cacheHitRate = totalPrompt > 0 ? ((totalCached / totalPrompt) * 100).toFixed(1) : "0.0";

  const cards = [
    {
      id: "requests",
      label: "Total Requests",
      value: totalRequests.toLocaleString(),
      subtext: activeCount > 0 ? `${activeCount} aktiv im Stream` : "Gesamtanfragen im Zeitraum",
      icon: "swap_calls",
      accent: "text-indigo-500 dark:text-indigo-400",
      iconBg: "bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-400",
      pulse: activeCount > 0,
    },
    {
      id: "input-tokens",
      label: "Prompt Tokens (In)",
      value: fmtTokens(totalPrompt),
      subtext: "Eingangs-Volumen an LLMs",
      icon: "arrow_downward",
      accent: "text-blue-500 dark:text-blue-400",
      iconBg: "bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400",
    },
    {
      id: "cached-tokens",
      label: "Prompt Cache",
      value: fmtTokens(totalCached),
      subtext: `${cacheHitRate}% Cache-Treffer`,
      icon: "bolt",
      accent: "text-emerald-500 dark:text-emerald-400",
      iconBg: "bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400",
      badge: `${cacheHitRate}% Hit`,
    },
    {
      id: "output-tokens",
      label: "Completion Tokens (Out)",
      value: fmtTokens(totalCompletion),
      subtext: "Generierte Antwort-Tokens",
      icon: "arrow_upward",
      accent: "text-purple-500 dark:text-purple-400",
      iconBg: "bg-purple-500/10 text-purple-500 dark:bg-purple-500/20 dark:text-purple-400",
    },
    {
      id: "cost",
      label: "Geschätzte Kosten",
      value: fmtCost(totalCost),
      subtext: `~${totalRequests > 0 ? ((totalCost / totalRequests) * 100).toFixed(2) : "0.00"}¢ pro Request`,
      icon: "payments",
      accent: "text-amber-500 dark:text-amber-400",
      iconBg: "bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400",
    },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <Card
          key={card.id}
          className="relative flex flex-col justify-between overflow-hidden p-4 transition-all duration-200 hover:shadow-md hover:border-primary/30"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {card.label}
            </span>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.iconBg}`}>
              <span className="material-symbols-outlined text-[18px]">{card.icon}</span>
            </div>
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-text-main">
              {card.value}
            </span>
            {card.badge && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                {card.badge}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
            {card.pulse && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
            <span className="truncate">{card.subtext}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object,
};
