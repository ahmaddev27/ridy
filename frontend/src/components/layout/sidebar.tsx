"use client";

import { Logo } from "@/components/brand/logo";
import { NavList } from "./nav-list";

/** Brand lockup shared by the desktop sidebar and the mobile drawer. */
export function SidebarBrand() {
  return (
    <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
      <Logo size={34} className="text-slate-900" />
      <div className="leading-tight">
        <div className="text-sm font-bold text-slate-900">Reidey</div>
        <div className="text-[11px] text-slate-400">Fleet Management</div>
      </div>
    </div>
  );
}

/** Desktop sidebar (hidden below lg — mobile uses the drawer in the topbar). */
export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-e border-slate-200 bg-white lg:flex">
      <SidebarBrand />
      <NavList />
    </aside>
  );
}
