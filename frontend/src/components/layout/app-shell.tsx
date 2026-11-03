"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ExtensionBanner } from "./extension-banner";
import { ImpersonationBanner } from "./impersonation-banner";

const COLLAPSED_KEY = "rdy-sidebar-collapsed";

/**
 * The inset-sheet shell: a floating glass sidebar on the canvas and one raised
 * sheet carrying the topbar, the banners and the (scrolling) page. Owns the two
 * pieces of shell state: desktop icon-rail collapse (persisted, Ctrl+B) and the
 * mobile drawer.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  // Navigating closes the mobile drawer.
  useEffect(() => setNavOpen(false), [pathname]);

  const toggleCollapsed = useCallback(() => {
    if (!window.matchMedia("(min-width: 961px)").matches) {
      setNavOpen(false);
      return;
    }
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  return (
    <div className={cn("app", collapsed && "collapsed", navOpen && "nav-open")}>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <div className="main">
        <div className="sheet">
          <Topbar onMenu={() => setNavOpen(true)} />
          <ImpersonationBanner />
          <ExtensionBanner />
          <main id="main" className="page-scroll">
            <div className="page">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
