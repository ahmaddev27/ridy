import { apiFetch } from "./client";

/** A landing-page contact-form submission, as shown in the admin inbox. */
export type ContactMessage = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  read: boolean;
  created_at: string | null;
};

const base = "/api/v1/admin/contact-messages";

/** All messages (newest first) plus the unread count. */
export async function listContactMessages(): Promise<{ messages: ContactMessage[]; unread: number }> {
  const res = await apiFetch<{ data: ContactMessage[]; meta: { unread: number } }>(base);
  return { messages: res.data, unread: res.meta?.unread ?? 0 };
}

export async function setContactMessageRead(id: number, read: boolean): Promise<ContactMessage> {
  const res = await apiFetch<{ data: ContactMessage }>(`${base}/${id}`, {
    method: "PATCH",
    body: { read },
    withCsrf: true,
  });
  return res.data;
}

export async function deleteContactMessage(id: number): Promise<void> {
  await apiFetch(`${base}/${id}`, { method: "DELETE", withCsrf: true });
}
