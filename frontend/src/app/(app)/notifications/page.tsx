"use client";

import { toast } from "sonner";
import { Bell, UserX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { useAsync } from "@/hooks/use-async";
import { useI18n } from "@/lib/i18n/context";
import {
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/api/notifications";

export default function NotificationsPage() {
  const { t } = useI18n();
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

      <Card className="max-w-2xl overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-600">{t("screens.notifications.loadError")} {error}</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t("screens.notifications.emptyTitle")}
            description={t("screens.notifications.emptyDesc")}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 p-4",
                  !n.read && "bg-indigo-50/30",
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                  <UserX className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  <p className="text-sm text-slate-500">{n.body}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs text-slate-400">
                    {n.created_at ? new Date(n.created_at).toLocaleString() : ""}
                  </span>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
