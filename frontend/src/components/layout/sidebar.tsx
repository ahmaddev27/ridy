"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { navGroups } from "./nav-config";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { user } = useAuth();

  // Full split: admin groups show only to super-admins; company groups hide
  // from them. Managers see the company surface, the admin sees the platform one.
  const groups = navGroups.filter((g) => {
    if (g.requiresRole && !user?.roles.includes(g.requiresRole)) return false;
    if (g.hideForRole && user?.roles.includes(g.hideForRole)) return false;
    return true;
  });

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold text-slate-900">Reidey</div>
          <div className="text-[11px] text-slate-400">Fleet Management</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 text-sm">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {t(group.title)}
            </p>
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 font-medium transition-colors",
                    active
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    {t(item.label)}
                  </span>
                  {item.badge && (
                    <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
