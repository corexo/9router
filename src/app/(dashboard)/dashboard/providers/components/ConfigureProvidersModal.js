"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PropTypes from "prop-types";
import { Input, Modal } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";

function ConfigureProvidersModal({ isOpen, onClose, providers }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter((p) => (p.name || p.id).toLowerCase().includes(q));
  }, [providers, query]);

  const open = (id) => {
    onClose();
    router.push(`/dashboard/providers/${id}`);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Provider einrichten"
      size="lg"
      showTrafficLights={false}
    >
      <div className="flex flex-col gap-3">
        <Input
          placeholder="Suchen..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => open(p.id)}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: `${
                    p.color?.length > 7 ? p.color : (p.color || "#888888") + "15"
                  }`,
                }}
              >
                <ProviderIcon
                  src={getProviderIconSrc(p.id)}
                  alt={p.name}
                  size={26}
                  fallbackText={p.textIcon || p.id.slice(0, 2).toUpperCase()}
                  fallbackColor={p.color}
                />
              </div>
              <span className="truncate text-sm font-medium">
                {p.name || p.id}
              </span>
              <span className="material-symbols-outlined ml-auto text-[16px] text-text-muted">
                chevron_right
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-text-muted">
              Alle Provider sind bereits eingerichtet
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

ConfigureProvidersModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  providers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string,
      color: PropTypes.string,
      textIcon: PropTypes.string,
    }),
  ).isRequired,
};

export default ConfigureProvidersModal;
