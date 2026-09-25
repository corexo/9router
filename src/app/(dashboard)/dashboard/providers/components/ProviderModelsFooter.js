"use client";

import PropTypes from "prop-types";
import { Toggle } from "@/shared/components";

function ProviderModelsFooter({ enabled, disabled, onToggleModel, onFetchModels, fetching }) {

  if (enabled.length === 0 && disabled.length === 0 && !onFetchModels) return null;

  // Card is a Link — keep clicks inside the footer from navigating.
  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="mt-2 border-t border-border pt-2" onClick={stop}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs text-text-muted">
          Verfügbare Modelle: {enabled.length}
          {disabled.length > 0 ? ` · ${disabled.length} deaktiviert` : ""}
        </span>
        {onFetchModels && (
          <button
            type="button"
            disabled={fetching}
            onClick={onFetchModels}
            className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-muted hover:border-primary/50 hover:text-primary disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[13px]${fetching ? " animate-spin" : ""}`}>refresh</span>
            {fetching ? "Rufe ab…" : "Modelle abrufen"}
          </button>
        )}
      </div>
      <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {[
            ...enabled.map((m) => ({ ...m, off: false })),
            ...disabled.map((m) => ({ ...m, off: true })),
          ]
            .sort((a, b) => (a.name || a.model).localeCompare(b.name || b.model))
            .map((m) => (
              <div
                key={m.model}
                className={`flex items-center gap-2 rounded-md px-1.5 py-1${
                  m.off ? " opacity-50" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                  {m.name || m.model}
                </span>
                {m.off && (
                  <span className="shrink-0 text-[10px] font-bold uppercase text-text-muted">
                    off
                  </span>
                )}
                <div className="shrink-0">
                  <Toggle
                    size="sm"
                    checked={!m.off}
                    onChange={() => onToggleModel(m.model, !m.off)}
                  />
                </div>
              </div>
            ))}
        </div>
    </div>
  );
}

ProviderModelsFooter.propTypes = {
  enabled: PropTypes.arrayOf(
    PropTypes.shape({
      model: PropTypes.string.isRequired,
      name: PropTypes.string,
    }),
  ).isRequired,
  disabled: PropTypes.arrayOf(
    PropTypes.shape({
      model: PropTypes.string.isRequired,
      name: PropTypes.string,
    }),
  ).isRequired,
  onToggleModel: PropTypes.func.isRequired,
  onFetchModels: PropTypes.func,
  fetching: PropTypes.bool,
};

export default ProviderModelsFooter;
