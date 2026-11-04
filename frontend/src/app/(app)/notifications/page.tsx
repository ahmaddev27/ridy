"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Bell, Trash2, CheckCheck } from "lucide-react";
import { PageHead, SkelRows } from "@/components/ui/rd";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, latnLocale } from "@/lib/utils";
import { notifContent } from "@/lib/notif-content";
import { useAppFeeds } from "@/components/layout/app-feeds";
import { useI18n } from "@/lib/i18n/context";
import {
  markAllNotificationsRead,
  deleteNotification,
  clearNotifications,
} from "@/lib/api/notifications";

export default function NotificationsPage() {
  const { t, locale } = useI18n();
  // Shares the app shell's single notifications poller (the bell uses the same feed).
  const { notifications: data, notificationsLoading: loading, notificationsError: error, refetchNotifications: refetch } = useAppFeeds();
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

  async function del(id: string) {
    try {
      await deleteNotification(id);
      await refetch();
    } catch {
      toast.error(t("screens.notifications.updateError"));
    }
  }

  async function clearAll() {
    try {
      await clearNotifications();
      toast.info(t("screens.notifications.cleared"));
      await refetch();
    } catch {
      toast.error(t("screens.notifications.updateError"));
    }
  }

  return (
    <>
      <PageHead
        title={t("pages.notifications.title")}
        sub={t("pages.notifications.subtitle")}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={markAll} disabled={unread === 0}>
              <CheckCheck />
              <span>{t("screens.notifications.markAllRead")}</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={clearAll} disabled={items.length === 0}>
              <Trash2 />
              <span>{t("screens.notifications.clearAll")}</span>
            </button>
          </>
        }
      />

      <section className="card">
        {loading ? (
          <SkelRows rows={3} cols={3} />
        ) : error && !data ? (
          <div className="callout danger" style={{ margin: 16 }}>
            <div>
              {t("screens.notifications.loadError")} {error}
            </div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Bell} title={t("screens.notifications.emptyTitle")} description={t("screens.notifications.emptyDesc")} />
        ) : (
          <div className="list-rows">
            {items.map((n) => {
              const { icon: Icon, chip, title, body, href } = notifContent(n, t);
              return (
                <div key={n.id} className={cn("list-row notif-row", !n.read && "unread")} style={{ alignItems: "flex-start" }}>
                  <span className={cn("stat-ico", chip)} style={{ width: 36, height: 36, borderRadius: 99, flexShrink: 0 }}>
                    <Icon />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    {href ? (
                      <Link href={href} className="strong">
                        {title}
                      </Link>
                    ) : (
                      <span className="strong">{title}</span>
                    )}
                    <div className="muted text-sm">{body}</div>
                  </div>
                  <div style={{ textAlign: "end", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <span className="when num">{n.created_at ? new Date(n.created_at).toLocaleString(latnLocale(locale)) : ""}</span>
                    {!n.read && <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--primary)" }} />}
                  </div>
                  <button type="button" className="icon-btn" onClick={() => del(n.id)} title={t("screens.notifications.delete")} aria-label={t("screens.notifications.delete")}>
                    <Trash2 />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
