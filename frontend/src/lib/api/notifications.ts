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
