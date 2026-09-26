"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useTheme } from "@/shared/hooks/useTheme";

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navSections = [
  {
    title: "Operations & Flow",
    items: [
      { href: "/dashboard/cockpit", label: "Cockpit", icon: "space_dashboard", badge: "LIVE" },
      { href: "/dashboard/flow", label: "Request Flow", icon: "route" },
      { href: "/dashboard/usage", label: "Usage & Analytics", icon: "monitoring" },
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
  const { toggleTheme, isDark } = useTheme();

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.assign("/login");
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  // Floating hover tooltip state (position: fixed)
  const [tooltip, setTooltip] = useState(null);

  // Media flyout state for compact mode
  const [mediaFlyoutOpen, setMediaFlyoutOpen] = useState(false);
  const [mediaFlyoutPos, setMediaFlyoutPos] = useState({ top: 0, left: 0 });
  const mediaFlyoutTimerRef = useRef(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.enableTranslator) setEnableTranslator(true);
      })
      .catch(() => {});
  }, []);

  const isActive = (href, stage) => {
    if (stage) {
      if (typeof window !== "undefined") {
        return pathname === "/dashboard/jev-inspector" && window.location.search.includes(`stage=${stage}`);
      }
      return false;
    }
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname === "/dashboard/endpoint" || pathname.startsWith("/dashboard/endpoint/");
    }
    if (href === "/dashboard/jev-inspector") {
      if (typeof window !== "undefined" && window.location.search.includes("stage=")) {
        return false;
      }
      return pathname === "/dashboard/jev-inspector";
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  const isMediaActive = () => {
    return pathname.startsWith("/dashboard/media-providers");
  };

  const handleMouseEnter = (e, label, badge, sectionTitle) => {
    if (!collapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      label,
      badge,
      section: sectionTitle,
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    });
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  const handleMediaMouseEnter = (e) => {
    if (!collapsed) return;
    if (mediaFlyoutTimerRef.current) clearTimeout(mediaFlyoutTimerRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    setMediaFlyoutPos({
      top: Math.max(10, rect.top - 20),
      left: rect.right + 12,
    });
    setMediaFlyoutOpen(true);
    setTooltip(null);
  };

  const handleMediaMouseLeave = () => {
    if (!collapsed) return;
    mediaFlyoutTimerRef.current = setTimeout(() => {
      setMediaFlyoutOpen(false);
    }, 180);
  };

  const handleFlyoutMouseEnter = () => {
    if (mediaFlyoutTimerRef.current) clearTimeout(mediaFlyoutTimerRef.current);
  };

  const handleFlyoutMouseLeave = () => {
    setMediaFlyoutOpen(false);
  };

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border/70 bg-surface/90 dark:bg-[#121214]/90 backdrop-blur-xl transition-[width] duration-200 min-h-full shrink-0 relative select-none",
        collapsed ? "w-[68px]" : "w-64"
      )}
    >
      {/* Top Header / Brand */}
      <div className={cn("flex items-center shrink-0 border-b border-border/40", collapsed ? "h-16 justify-center px-2" : "h-16 justify-between px-4")}>
        <Link
          href="/dashboard"
          onClick={onClose}
          onMouseEnter={(e) => handleMouseEnter(e, APP_CONFIG.name || "PiRouter", `v${APP_CONFIG.version}`, "Dashboard")}
          onMouseLeave={handleMouseLeave}
          className="flex items-center gap-2.5 group"
        >
          <div className="flex items-center justify-center size-9 rounded-xl bg-gradient-to-br from-emerald-500 via-teal-600 to-indigo-600 text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 group-hover:shadow-emerald-500/30 transition-all shrink-0">
            <span className="material-symbols-outlined text-[20px]">router</span>
          </div>

          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold tracking-tight text-sm text-text-main truncate">
                  {APP_CONFIG.name || "PiRouter"}
                </span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-primary/15 text-primary font-mono font-bold">
                  ROUTER
                </span>
              </div>
              <span className="text-[10px] text-text-muted font-mono leading-none">v{APP_CONFIG.version}</span>
            </div>
          )}
        </Link>

        {!collapsed && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Sidebar einklappen"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">dock_to_left</span>
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <nav
        onScroll={handleMouseLeave}
        className={cn(
          "flex-1 py-3 overflow-y-auto overflow-x-hidden custom-scrollbar",
          collapsed ? "px-2 space-y-3" : "px-3 space-y-4"
        )}
      >
        {navSections.map((section, sIdx) => {
          const visibleItems = section.items.filter(
            (item) => !item.requiresTranslator || enableTranslator
          );

          return (
            <div key={section.title || sIdx} className="space-y-1">
              {!collapsed ? (
                <div className="px-2 pb-1 pt-1 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-text-muted/70 uppercase tracking-wider font-mono">
                    {section.title}
                  </span>
                </div>
              ) : sIdx > 0 ? (
                <div className="py-1 flex justify-center">
                  <div className="w-5 h-[1px] rounded-full bg-border/60" />
                </div>
              ) : null}

              <div className={cn("space-y-1", collapsed ? "flex flex-col items-center" : "")}>
                {visibleItems.map((item) => {
                  const active = isActive(item.href, item.stage);

                  return (
                    <Link
                      key={item.href + (item.stage || "")}
                      href={item.href}
                      onClick={onClose}
                      onMouseEnter={(e) => handleMouseEnter(e, item.label, item.badge, section.title)}
                      onMouseLeave={handleMouseLeave}
                      className={cn(
                        "relative flex items-center transition-all duration-150 group",
                        collapsed
                          ? "justify-center size-10 rounded-xl"
                          : "gap-3 px-3 py-2 rounded-xl text-xs font-medium w-full",
                        active
                          ? "bg-primary/15 text-primary font-semibold shadow-xs border border-primary/25"
                          : "text-text-muted hover:bg-surface-2 dark:hover:bg-neutral-800/60 hover:text-text-main"
                      )}
                    >
                      {/* Active indicator bar on left in collapsed mode */}
                      {collapsed && active && (
                        <span className="absolute -left-2 w-1 h-5 rounded-r-full bg-primary shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                      )}

                      <span
                        className={cn(
                          "material-symbols-outlined shrink-0 transition-transform duration-150",
                          collapsed ? "text-[20px] group-hover:scale-110" : "text-[18px]",
                          active ? "text-primary" : "group-hover:text-text-main"
                        )}
                      >
                        {item.icon}
                      </span>

                      {/* Live Badge dot in collapsed mode */}
                      {collapsed && item.badge && (
                        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-emerald-500 ring-2 ring-surface shadow-xs animate-pulse" />
                      )}

                      {!collapsed && (
                        <span className="truncate flex-1 tracking-tight">{item.label}</span>
                      )}

                      {!collapsed && item.badge && (
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}

                {/* Media Providers Item in System & Tools section */}
                {section.title === "System & Tools" && (
                  collapsed ? (
                    <div
                      onMouseEnter={handleMediaMouseEnter}
                      onMouseLeave={handleMediaMouseLeave}
                      className="relative"
                    >
                      <button
                        type="button"
                        className={cn(
                          "relative flex items-center justify-center size-10 rounded-xl transition-all duration-150 group",
                          isMediaActive()
                            ? "bg-primary/15 text-primary font-semibold shadow-xs border border-primary/25"
                            : "text-text-muted hover:bg-surface-2 dark:hover:bg-neutral-800/60 hover:text-text-main"
                        )}
                        aria-label="Media Providers"
                      >
                        {isMediaActive() && (
                          <span className="absolute -left-2 w-1 h-5 rounded-r-full bg-primary shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                        )}
                        <span className="material-symbols-outlined text-[20px] shrink-0 group-hover:scale-110 transition-transform duration-150">
                          perm_media
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="pt-0.5">
                      <button
                        type="button"
                        onClick={() => setMediaOpen((v) => !v)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-xs font-medium group",
                          isMediaActive()
                            ? "bg-primary/15 text-primary font-semibold border border-primary/25"
                            : "text-text-muted hover:bg-surface-2 dark:hover:bg-neutral-800/60 hover:text-text-main"
                        )}
                      >
                        <span className="material-symbols-outlined text-[18px] shrink-0">perm_media</span>
                        <span className="flex-1 text-left truncate">Media Providers</span>
                        <span
                          className="material-symbols-outlined text-[15px] transition-transform duration-200 text-text-muted"
                          style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                        >
                          expand_more
                        </span>
                      </button>

                      {mediaOpen && (
                        <div className="pl-3.5 space-y-1 mt-1 border-l-2 border-border/50 ml-4">
                          {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => {
                            const active = pathname.startsWith(`/dashboard/media-providers/${kind.id}`);
                            return (
                              <Link
                                key={kind.id}
                                href={`/dashboard/media-providers/${kind.id}`}
                                onClick={onClose}
                                className={cn(
                                  "flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all text-xs",
                                  active
                                    ? "bg-primary/15 text-primary font-medium"
                                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                                )}
                              >
                                <span className="material-symbols-outlined text-[15px] shrink-0">{kind.icon}</span>
                                <span className="truncate">{kind.label}</span>
                              </Link>
                            );
                          })}
                          <Link
                            key={COMBINED_WEB_ITEM.id}
                            href={COMBINED_WEB_ITEM.href}
                            onClick={onClose}
                            className={cn(
                              "flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all text-xs",
                              pathname.startsWith(COMBINED_WEB_ITEM.href)
                                ? "bg-primary/15 text-primary font-medium"
                                : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                            )}
                          >
                            <span className="material-symbols-outlined text-[15px] shrink-0">{COMBINED_WEB_ITEM.icon}</span>
                            <span className="truncate">{COMBINED_WEB_ITEM.label}</span>
                          </Link>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer Area */}
      <div className={cn("border-t border-border/50 shrink-0 bg-surface-2/40 dark:bg-neutral-900/30", collapsed ? "p-2 flex flex-col items-center gap-1.5" : "p-3")}>
        {collapsed ? (
          <>
            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              onMouseEnter={(e) => handleMouseEnter(e, isDark ? "Light Mode" : "Dark Mode", null, "Design")}
              onMouseLeave={handleMouseLeave}
              className="flex items-center justify-center size-10 rounded-xl text-text-muted hover:text-text-main hover:bg-surface-2 dark:hover:bg-neutral-800 transition-colors"
              aria-label="Theme wechseln"
            >
              <span className="material-symbols-outlined text-[19px]">
                {isDark ? "light_mode" : "dark_mode"}
              </span>
            </button>

            {/* Collapse toggle button at bottom */}
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                onMouseEnter={(e) => handleMouseEnter(e, "Sidebar ausklappen", null, "Ansicht")}
                onMouseLeave={handleMouseLeave}
                className="flex items-center justify-center size-10 rounded-xl text-text-muted hover:text-text-main hover:bg-surface-2 dark:hover:bg-neutral-800 transition-colors"
                aria-label="Sidebar ausklappen"
              >
                <span className="material-symbols-outlined text-[19px]">dock_to_right</span>
              </button>
            )}

            {/* Logout button */}
            <button
              type="button"
              onClick={handleLogout}
              onMouseEnter={(e) => handleMouseEnter(e, "Abmelden", null, "Sitzung")}
              onMouseLeave={handleMouseLeave}
              className="flex items-center justify-center size-10 rounded-xl text-red-500/80 hover:text-red-500 hover:bg-red-500/10 dark:hover:bg-red-500/15 transition-colors"
              aria-label="Abmelden"
            >
              <span className="material-symbols-outlined text-[19px]">logout</span>
            </button>

            {/* Status Beacon */}
            <div
              onMouseEnter={(e) => handleMouseEnter(e, "PiRouter Online", "PORT 9310", "System")}
              onMouseLeave={handleMouseLeave}
              className="flex items-center justify-center size-8 rounded-xl cursor-default mt-0.5"
            >
              <span className="relative flex size-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex-1 flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-main hover:bg-surface-2 dark:hover:bg-neutral-800 transition-colors border border-border/50"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isDark ? "light_mode" : "dark_mode"}
                </span>
                <span>{isDark ? "Light" : "Dark"}</span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="flex-1 flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-500/10 dark:hover:bg-red-500/15 transition-colors border border-red-500/20 font-medium"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>Logout</span>
              </button>
            </div>

            <div className="flex items-center justify-between px-1 pt-1 text-xs border-t border-border/40">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex size-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
                </span>
                <span className="font-mono text-[11px] text-text-main font-semibold truncate">PiRouter Online</span>
              </div>
              <span className="font-mono text-[10px] text-text-muted shrink-0 px-1.5 py-0.5 rounded bg-surface-3/50 dark:bg-neutral-800">
                9310
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Floating Hover Tooltip (rendered outside scrolling container via fixed coords) */}
      {collapsed && tooltip && (
        <div
          style={{ top: `${tooltip.top}px`, left: `${tooltip.left}px` }}
          className="fixed -translate-y-1/2 z-[9999] pointer-events-none transition-all duration-100 ease-out select-none"
        >
          <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900/95 dark:bg-neutral-800/95 text-white text-xs font-medium shadow-2xl border border-white/10 dark:border-white/15 backdrop-blur-md whitespace-nowrap">
            {/* Pointer arrow pointing back to sidebar icon */}
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 size-2 rotate-45 bg-neutral-900/95 dark:bg-neutral-800/95 border-l border-b border-white/10 dark:border-white/15" />

            {tooltip.section && (
              <span className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">
                {tooltip.section} ·
              </span>
            )}
            <span className="font-semibold text-neutral-100">{tooltip.label}</span>
            {tooltip.badge && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 border border-emerald-500/30">
                {tooltip.badge}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Media Providers Flyout Menu for Compact Mode */}
      {collapsed && mediaFlyoutOpen && (
        <div
          style={{ top: `${mediaFlyoutPos.top}px`, left: `${mediaFlyoutPos.left}px` }}
          onMouseEnter={handleFlyoutMouseEnter}
          onMouseLeave={handleFlyoutMouseLeave}
          className="fixed z-[9999] w-52 p-2 rounded-xl bg-surface/95 dark:bg-[#1a1a1c]/95 border border-border shadow-2xl backdrop-blur-xl transition-all duration-150 select-none"
        >
          <div className="px-2.5 py-1.5 border-b border-border/50 mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted font-mono">
              Media Providers
            </span>
            <span className="material-symbols-outlined text-[15px] text-primary">perm_media</span>
          </div>
          <div className="space-y-0.5">
            {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => {
              const active = pathname.startsWith(`/dashboard/media-providers/${kind.id}`);
              return (
                <Link
                  key={kind.id}
                  href={`/dashboard/media-providers/${kind.id}`}
                  onClick={() => {
                    setMediaFlyoutOpen(false);
                    if (onClose) onClose();
                  }}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                    active
                      ? "bg-primary/15 text-primary font-semibold"
                      : "text-text-muted hover:text-text-main hover:bg-surface-2 dark:hover:bg-neutral-800"
                  )}
                >
                  <span className="material-symbols-outlined text-[16px] shrink-0">{kind.icon}</span>
                  <span className="truncate">{kind.label}</span>
                </Link>
              );
            })}
            <Link
              key={COMBINED_WEB_ITEM.id}
              href={COMBINED_WEB_ITEM.href}
              onClick={() => {
                setMediaFlyoutOpen(false);
                if (onClose) onClose();
              }}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                pathname.startsWith(COMBINED_WEB_ITEM.href)
                  ? "bg-primary/15 text-primary font-semibold"
                  : "text-text-muted hover:text-text-main hover:bg-surface-2 dark:hover:bg-neutral-800"
              )}
            >
              <span className="material-symbols-outlined text-[16px] shrink-0">{COMBINED_WEB_ITEM.icon}</span>
              <span className="truncate">{COMBINED_WEB_ITEM.label}</span>
            </Link>
          </div>
        </div>
      )}
    </aside>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  collapsed: PropTypes.bool,
  onToggleCollapse: PropTypes.func,
};
