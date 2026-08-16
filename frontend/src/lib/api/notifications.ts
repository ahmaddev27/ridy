import { apiFetch } from "./client";

export type AppNotification = {
  id: string;
  type: string | null;
  /** Structured params the frontend renders in the user's language. */
  params: Record<string, string | number>;
  href: string | null;
  /** Legacy pre-rendered strings (older notifications) — fallback only. */
  title: string | null;
  body: string | null;
  read: boolean;
  created_at: string | null;
};

export async function listNotifications(): Promise<{
  items: AppNotification[];
  unread: number;
}> {
  const res = await apiFetch<{ data: AppNotification[]; meta: { unread: number } }>(
    "/api/v1/notifications",
  );
  return { items: res.data, unread: res.meta.unread };
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch("/api/v1/notifications/read", { method: "POST", withCsrf: true });
}

export async function deleteNotification(id: string): Promise<void> {
  await apiFetch(`/api/v1/notifications/${id}`, { method: "DELETE", withCsrf: true });
}

export async function clearNotifications(): Promise<void> {
  await apiFetch("/api/v1/notifications/clear", { method: "DELETE", withCsrf: true });
}

/** User-configurable notification categories (bell is always on, not listed). */
export const NOTIFICATION_CATEGORIES = [
  "sessions",
  "subscription",
  "platform",
  "codes",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationChannel = "push" | "email";

/** Per-channel, per-category toggles. Each value: true = channel enabled. */
export type NotificationPrefs = Record<NotificationChannel, Record<NotificationCategory, boolean>>;

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const res = await apiFetch<{ data: NotificationPrefs }>("/api/v1/notification-prefs");
  return res.data;
}

export async function updateNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<NotificationPrefs> {
  const res = await apiFetch<{ data: NotificationPrefs }>("/api/v1/notification-prefs", {
    method: "PUT",
    body: prefs,
    withCsrf: true,
  });
  return res.data;
}
