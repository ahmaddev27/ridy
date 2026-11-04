"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";
import { NavList } from "./nav-list";

type Tip = { label: string; top: number; pos: { left: number } | { right: number } } | null;

/**
 * Floating glass sidebar of the inset-sheet shell: brand row with the collapse
 * toggle, the role-filtered nav groups, and (collapsed only) a hover/focus
 * tooltip carrying each item's label. On mobile the same element slides in as a
 * drawer (see `.app.nav-open`).
 */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [tip, setTip] = useState<Tip>(null);
  const home = user?.roles.includes("super_admin") ? "/admin" : user?.roles.includes("reseller") ? "/reseller" : "/dashboard";
  const toggleLabel = collapsed ? t("topbar.sidebarExpand") : t("topbar.sidebarCollapse");

  function showTip(el: HTMLElement) {
    const label = el.dataset.tip;
    if (!collapsed || !label || !window.matchMedia("(min-width: 961px)").matches) return setTip(null);
    const r = el.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    setTip({ label, top: r.top + r.height / 2, pos: rtl ? { right: window.innerWidth - r.left + 10 } : { left: r.right + 10 } });
  }

  return (
    <aside
      className="sidebar"
      id="sidebar"
      onMouseOver={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
        if (el) showTip(el);
        else setTip(null);
      }}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
        if (el) showTip(el);
      }}
      onBlur={() => setTip(null)}
    >
      <div className="brand-row">
        <Link className="brand" href={home} data-tip="Reidey">
          <span className="brand-mark"><Logo size={24} tight /></span>
          <span className="brand-text">
            <span className="brand-name">Reidey</span>
            <span className="subtle text-xs">{t("topbar.brandSub")}</span>
          </span>
        </Link>
        <button
          type="button"
          className="icon-btn sb-toggle"
          onClick={onToggle}
          aria-controls="sidebar"
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          data-tip={`${toggleLabel} · Strg B`}
        >
          <span className="i-close"><PanelLeftClose /></span>
          <span className="i-open"><PanelLeftOpen /></span>
          <span className="i-mob"><X /></span>
        </button>
      </div>
      <NavList />
      <div className="sidebar-foot" />
      {/* Portal: the sidebar's backdrop-filter would otherwise trap a fixed child. */}
      {tip &&
        createPortal(
          <div className="sb-tip" role="tooltip" style={{ top: tip.top, transform: "translateY(-50%)", ...tip.pos }}>
            {tip.label}
          </div>,
          document.body,
        )}
    </aside>
  );
}
