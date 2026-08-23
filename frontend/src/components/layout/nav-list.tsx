"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "./nav-config";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { listContactMessages } from "@/lib/api/contact-messages";

/**
 * The navigation list — role-filtered groups + links. Shared by the desktop
 * Sidebar and the mobile drawer. `onNavigate` lets the drawer close on click.
 */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { user } = useAuth();

  // Unread contact-form messages, shown as a badge on the admin Inbox link.
  const isAdmin = user?.roles.includes("super_admin") ?? false;
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const load = () =>
      listContactMessages()
        .then((r) => alive && setUnread(r.unread))
        .catch(() => {});
    load();
    const id = setInterval(load, 30000); // refresh a couple of times a minute
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isAdmin]);

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
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
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
            // Live unread count on the Inbox link; other links keep any static badge.
            const inboxUnread = item.href === "/admin/inbox" && unread > 0 ? unread : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-ink shadow-sm dark:bg-surface-2 dark:text-ink dark:ring-1 dark:ring-inset dark:ring-line-strong dark:shadow-none"
                    : "text-ink-muted hover:bg-surface-2",
                )}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  {t(item.label)}
                </span>
                {inboxUnread ? (
                  <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-bold text-primary-ink">
                    {inboxUnread}
                  </span>
                ) : item.badge ? (
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
