"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "./nav-config";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";

/**
 * The navigation list — role-filtered groups + links. Shared by the desktop
 * Sidebar and the mobile drawer. `onNavigate` lets the drawer close on click.
 */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { user } = useAuth();

  // Full split: admin groups show only to super-admins; company groups hide
  // from them; the account group shows to everyone.
  const groups = navGroups.filter((g) => {
    if (g.requiresRole && !user?.roles.includes(g.requiresRole)) return false;
    if (g.hideForRole) {
      const hidden = Array.isArray(g.hideForRole) ? g.hideForRole : [g.hideForRole];
      if (hidden.some((r) => user?.roles.includes(r))) return false;
    }
    return true;
  });

  return (
    <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-6 text-sm">
      {groups.map((group) => (
        <div key={group.title} className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t(group.title)}
          </p>
          {group.items.map((item) => {
            // Active on the exact route or any nested route (e.g. a company
            // detail page under /admin/companies). Index routes match exactly so
            // they don't light up for their siblings' sub-pages.
            const isIndex = item.href === "/admin" || item.href === "/dashboard";
            const active =
              pathname === item.href || (!isIndex && pathname.startsWith(item.href + "/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 font-medium transition-colors",
                  active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  {t(item.label)}
                </span>
                {item.badge && (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
