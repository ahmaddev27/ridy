import { apiFetch } from "./client";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type: string | null;
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
