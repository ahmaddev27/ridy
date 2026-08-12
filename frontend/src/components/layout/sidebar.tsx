"use client";

import { Logo } from "@/components/brand/logo";
import { NavList } from "./nav-list";

/** Brand lockup shared by the desktop sidebar and the mobile drawer. */
export function SidebarBrand() {
  return (
    <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
      <Logo size={52} className="text-ink" />
      <div className="leading-tight">
        <div className="text-sm font-bold text-ink">Reidey</div>
        <div className="text-[11px] text-ink-subtle">Fleet Management</div>
      </div>
    </div>
  );
}

/** Desktop sidebar (hidden below lg — mobile uses the drawer in the topbar). */
export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-e border-line bg-surface lg:flex">
      <SidebarBrand />
      <NavList />
    </aside>
  );
}
