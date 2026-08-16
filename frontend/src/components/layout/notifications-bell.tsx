"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { cn, latnLocale } from "@/lib/utils";
import { notifContent } from "@/lib/notif-content";
import { useI18n } from "@/lib/i18n/context";
import type { AppNotification } from "@/lib/api/notifications";

/**
 * Bell with a hover/click dropdown of the latest 5 notifications, so a quick
 * peek doesn't require opening the full page. Full list stays one click away.
 */
export function NotificationsBell({ items, unread }: { items: AppNotification[]; unread: number }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latest = items.slice(0, 5);

  // Small grace delay so moving the cursor into the panel doesn't dismiss it.
  function scheduleClose() {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-ink-muted hover:bg-surface-2"
        aria-label={t("screens.notifications.title") || "Notifications"}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-ring px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute end-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-surface text-start shadow-xl"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">{t("screens.notifications.title")}</span>
            {unread > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-ink">{unread}</span>
            )}
          </div>

          {latest.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-subtle">
              {t("screens.notifications.emptyTitle")}
            </div>
          ) : (
            <div className="max-h-96 divide-y divide-line overflow-y-auto">
              {latest.map((n) => {
                const { icon: Icon, chip, title, body, href } = notifContent(n, t);
                return (
                  <Link
                    key={n.id}
                    href={href || "/notifications"}
                    onClick={() => setOpen(false)}
                    className={cn("flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2", !n.read && "bg-surface-2/40")}
                  >
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", chip)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{title}</p>
                      <p className="truncate text-xs text-ink-muted">{body}</p>
                    </div>
                    <span className="whitespace-nowrap text-[10px] text-ink-subtle">
                      {n.created_at ? new Date(n.created_at).toLocaleDateString(latnLocale(locale)) : ""}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            {t("screens.notifications.viewAll")}
          </Link>
        </div>
      )}
    </div>
  );
}
