"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, latnLocale } from "@/lib/utils";
import { notifContent } from "@/lib/notif-content";
import { useAsync } from "@/hooks/use-async";
import { useI18n } from "@/lib/i18n/context";
import {
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/api/notifications";

export default function NotificationsPage() {
  const { t, locale } = useI18n();
  const { data, loading, error, refetch } = useAsync(listNotifications, { refetchInterval: 15000 });
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  async function markAll() {
    try {
      await markAllNotificationsRead();
      toast.info(t("screens.notifications.allMarkedRead"));
      await refetch();
    } catch {
      toast.error(t("screens.notifications.updateError"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="notifications"
        action={
          <Button variant="secondary" onClick={markAll} disabled={unread === 0}>
            {t("screens.notifications.markAllRead")}
          </Button>
        }
      />

      <Card className="w-full overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-danger-fg">{t("screens.notifications.loadError")} {error}</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t("screens.notifications.emptyTitle")}
            description={t("screens.notifications.emptyDesc")}
          />
        ) : (
          <div className="divide-y divide-line">
            {items.map((n) => {
              const { icon: Icon, chip, title, body, href } = notifContent(n, t);
              const inner = (
                <>
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", chip)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{title}</p>
                    <p className="text-sm text-ink-muted">{body}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-xs text-ink-subtle">
                      {n.created_at ? new Date(n.created_at).toLocaleString(latnLocale(locale)) : ""}
                    </span>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                </>
              );
              const cls = cn("flex items-start gap-3 p-4 text-start transition-colors", !n.read && "bg-surface-2/30", href && "hover:bg-surface-2");
              return href ? (
                <Link key={n.id} href={href} className={cls}>{inner}</Link>
              ) : (
                <div key={n.id} className={cls}>{inner}</div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
