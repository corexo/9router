"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navSections = [
  {
    title: "Operations & Flow",
    items: [
      { href: "/dashboard/cockpit", label: "Cockpit", icon: "space_dashboard", badge: "LIVE" },
      { href: "/dashboard/flow", label: "Request Flow", icon: "route" },
      { href: "/dashboard/usage2", label: "Usage & Analytics", icon: "monitoring" },
      { href: "/dashboard/usage", label: "Usage (Klassisch)", icon: "bar_chart" },
      { href: "/dashboard/cache", label: "Cache Effizienz", icon: "bolt" },
      { href: "/dashboard/cache-sessions", label: "Cache Sessions", icon: "cached" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
      { href: "/dashboard/widgets", label: "Widgets", icon: "dashboard_customize" },
    ],
  },
  {
    title: "Jev Inspector",
    items: [
      { href: "/dashboard/jev-inspector", label: "Alle Stufen", icon: "manage_search" },
      { href: "/dashboard/jev-inspector?stage=incoming", label: "\u2460 Pi-Request", icon: "login", stage: "incoming" },
      { href: "/dashboard/jev-inspector?stage=fullPayload", label: "\u2461 Jev-Request", icon: "outbound", stage: "fullPayload" },
      { href: "/dashboard/jev-inspector?stage=jevResponse", label: "\u2462 Jev-Antwort", icon: "reply", stage: "jevResponse" },
      { href: "/dashboard/jev-inspector?stage=outgoing", label: "\u2463 Response an Pi", icon: "logout", stage: "outgoing" },
    ],
  },
  {
    title: "Routing & Accounts",
    items: [
      { href: "/dashboard/providers", label: "Providers & Accounts", icon: "dns" },
      { href: "/dashboard/combos", label: "Combos & Fallbacks", icon: "layers" },
      { href: "/dashboard/endpoint", label: "Endpoints & Keys", icon: "api" },
      { href: "/dashboard/cli-tools", label: "CLI Tools & IDE", icon: "terminal" },
    ],
  },
  {
    title: "System & Tools",
    items: [
      { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
      { href: "/dashboard/skills", label: "Agent Skills", icon: "extension" },
      { href: "/dashboard/console-log", label: "Console Logs", icon: "receipt_long" },
      { href: "/dashboard/translator", label: "Translator", icon: "translate", requiresTranslator: true },
      { href: "/dashboard/profile", label: "Einstellungen", icon: "settings" },
    ],
  },
];

export default function Sidebar({ onClose, collapsed = false, onToggleCollapse }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.enableTranslator) setEnableTranslator(true);
      })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname === "/dashboard/endpoint" || pathname.startsWith("/dashboard/endpoint/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <aside className={cn(
      "flex flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-all duration-300 min-h-full shrink-0 relative",
      collapsed ? "w-16" : "w-72"
    )}>
      {/* Traffic lights & Collapse Toggle Button */}
      <div className={cn("flex items-center pt-5 pb-2", collapsed ? "justify-center px-2" : "justify-between px-5")}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
          </div>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
            className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">
              {collapsed ? "dock_to_right" : "dock_to_left"}
            </span>
          </button>
        )}
      </div>

      {/* Logo & Brand Header */}
      <div className={cn("py-3 flex flex-col gap-2", collapsed ? "px-2 items-center" : "px-5")}>
        <Link href="/dashboard" className="flex items-center gap-3 group" title={collapsed ? (APP_CONFIG.name || "PiRouter") : undefined}>
          <div className="flex items-center justify-center size-9 rounded-[10px] bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 shadow-md transition-transform group-hover:scale-105 shrink-0">
            <span className="material-symbols-outlined text-white text-[20px]">router</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold tracking-tight text-text-main truncate">
                  {APP_CONFIG.name || "PiRouter"}
                </h1>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-mono font-semibold">
                  ROUTER
                </span>
              </div>
              <span className="text-[11px] text-text-muted font-mono">v{APP_CONFIG.version}</span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation Sections */}
      <nav className={cn("flex-1 py-2 space-y-4 overflow-y-auto custom-scrollbar", collapsed ? "px-1.5" : "px-3")}>
        {navSections.map((section, sIdx) => {
          // Filter items based on feature flags (e.g. translator)
          const visibleItems = section.items.filter(
            (item) => !item.requiresTranslator || enableTranslator
          );

          return (
            <div key={section.title || sIdx} className="space-y-0.5">
              {!collapsed ? (
                <p className="px-3 text-[11px] font-semibold text-text-muted/60 uppercase tracking-wider mb-1.5">
                  {section.title}
                </p>
              ) : (
                <div className="h-px bg-border/40 mx-2 my-2" />
              )}

              {visibleItems.map((item) => {
                const active = item.stage ? false : isActive(item.href);
                return (
                  <Link
                    key={item.href + (item.stage || "")}
                    href={item.href}
                    onClick={onClose}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center rounded-lg transition-all group",
                      collapsed ? "justify-center p-2" : "gap-3 px-3 py-1.5",
                      active
                        ? "bg-primary/10 text-primary font-medium shadow-xs"
                        : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                    )}
                  >
                    <span
                      className={cn(
                        "material-symbols-outlined text-[18px] shrink-0",
                        active ? "fill-1 text-primary" : "group-hover:text-primary transition-colors"
                      )}
                    >
                      {item.icon}
                    </span>
                    {!collapsed && <span className="text-[13px] flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.badge && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}

              {/* Accordion for Media Providers in System section */}
              {section.title === "System & Tools" && !collapsed && (
                <div className="pt-0.5">
                  <button
                    onClick={() => setMediaOpen((v) => !v)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-1.5 rounded-lg transition-all group",
                      pathname.startsWith("/dashboard/media-providers")
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px]">perm_media</span>
                    <span className="text-[13px] font-medium flex-1 text-left">Media Providers</span>
                    <span
                      className="material-symbols-outlined text-[14px] transition-transform"
                      style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                    >
                      expand_more
                    </span>
                  </button>

                  {mediaOpen && (
                    <div className="pl-4 space-y-0.5 mt-1 border-l border-border/40 ml-4">
                      {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                        <Link
                          key={kind.id}
                          href={`/dashboard/media-providers/${kind.id}`}
                          onClick={onClose}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-1 rounded-lg transition-all text-xs",
                            pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                              ? "bg-primary/15 text-primary font-medium"
                              : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                          )}
                        >
                          <span className="material-symbols-outlined text-[15px]">{kind.icon}</span>
                          <span>{kind.label}</span>
                        </Link>
                      ))}
                      <Link
                        key={COMBINED_WEB_ITEM.id}
                        href={COMBINED_WEB_ITEM.href}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-1 rounded-lg transition-all text-xs",
                          pathname.startsWith(COMBINED_WEB_ITEM.href)
                            ? "bg-primary/15 text-primary font-medium"
                            : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                        )}
                      >
                        <span className="material-symbols-outlined text-[15px]">{COMBINED_WEB_ITEM.icon}</span>
                        <span>{COMBINED_WEB_ITEM.label}</span>
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer Status */}
      <div className={cn("border-t border-border-subtle/60 mt-auto bg-surface/30", collapsed ? "p-2 text-center" : "p-3")}>
        {!collapsed ? (
          <div className="flex items-center justify-between px-2 py-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-[11px] text-text-main font-medium">PiRouter Active</span>
            </div>
            <span className="font-mono text-[10px] text-text-muted">Port 9310</span>
          </div>
        ) : (
          <div className="flex justify-center py-1" title="PiRouter Active · Port 9310">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        )}
      </div>
    </aside>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  collapsed: PropTypes.bool,
  onToggleCollapse: PropTypes.func,
};
