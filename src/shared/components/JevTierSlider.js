"use client";

import { cn } from "@/shared/utils/cn";
import { TIER_PREFERENCES, DEFAULT_TIER_PREFERENCE } from "@/sse/services/modelTiers.js";

// Display metadata for the "Modell-Klasse" slider. Order matches TIER_PREFERENCES
// (index = slider position); the ids are the persisted `jevTierPreference` values.
const STEP_META = {
  fast: { icon: "bolt", hint: "Nur FAST-Tier (Mini/Flash). Maximal günstig, für triviale Edits und Lookups." },
  eco: { icon: "eco", hint: "FAST + MID (z. B. Haiku, GLM 4.x, Qwen). Günstig für Routine-Coding." },
  balanced: { icon: "balance", hint: "Alle Tiers verfügbar — Jev entscheidet frei nach Schwierigkeit der Anfrage." },
  quality: { icon: "workspace_premium", hint: "STRONG + FRONTIER (z. B. Fable, Sonnet, GLM 5). Kleine Modelle werden nicht angeboten." },
  max: { icon: "diamond", hint: "Nur FRONTIER (z. B. Opus, GPT-6). Kosten spielen keine Rolle." },
};

export const TIER_SLIDER_STEPS = TIER_PREFERENCES.map((preference, index) => ({
  index,
  id: preference.id,
  label: preference.label,
  tiers: preference.tiers,
  ...STEP_META[preference.id],
}));

function stepFor(value) {
  return TIER_SLIDER_STEPS.find((step) => step.id === value)
    || TIER_SLIDER_STEPS.find((step) => step.id === DEFAULT_TIER_PREFERENCE);
}

/**
 * Controlled slider: `value` is a preference id ("fast" … "max"),
 * `onChange(id)` fires on every step change.
 */
export default function JevTierSlider({ value, onChange, disabled = false, compact = false, className }) {
  const current = stepFor(value);
  const max = TIER_SLIDER_STEPS.length - 1;

  return (
    <div className={cn("flex flex-col gap-2", disabled && "opacity-60", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-[18px] text-indigo-600 dark:text-indigo-400">{current.icon}</span>
          <span className="text-sm font-semibold text-text-main truncate">{current.label}</span>
        </div>
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted shrink-0">
          {current.tiers.join(" · ")}
        </span>
      </div>

      <input
        type="range"
        min="0"
        max={max}
        step="1"
        value={current.index}
        disabled={disabled}
        onChange={(e) => onChange?.(TIER_SLIDER_STEPS[Number(e.target.value)].id)}
        className="w-full accent-primary cursor-pointer disabled:cursor-not-allowed"
        aria-label="Modell-Klasse für Jev"
        aria-valuetext={current.label}
        list="jev-tier-slider-ticks"
      />
      <datalist id="jev-tier-slider-ticks">
        {TIER_SLIDER_STEPS.map((step) => (
          <option key={step.id} value={step.index} label={step.label} />
        ))}
      </datalist>

      <div className="flex justify-between text-[10px] text-text-muted select-none">
        {TIER_SLIDER_STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(step.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 w-1/5 hover:text-text-main transition-colors disabled:cursor-not-allowed",
              step.id === current.id && "text-text-main font-semibold"
            )}
          >
            <span className="material-symbols-outlined text-[14px]">{step.icon}</span>
            {!compact && <span className="leading-tight text-center">{step.label}</span>}
          </button>
        ))}
      </div>

      <p className="text-xs text-text-muted leading-relaxed">{current.hint}</p>
    </div>
  );
}
