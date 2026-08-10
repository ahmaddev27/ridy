import { apiFetch } from "./client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type EmailTemplate = {
  key: string;
  subject: string;
  body_html: string;
  logo_url: string | null;
  accent_color: string | null;
  footer_text: string | null;
  variables: string[];
};

export type UpdateTemplateInput = {
  subject: string;
  body_html: string;
  logo_url?: string | null;
  accent_color?: string | null;
  footer_text?: string | null;
};

export async function listTemplates(): Promise<EmailTemplate[]> {
  const res = await apiFetch<{ data: EmailTemplate[] }>("/api/v1/admin/email-templates");
  return res.data;
}

export async function updateTemplate(key: string, input: UpdateTemplateInput): Promise<EmailTemplate> {
  const res = await apiFetch<{ data: EmailTemplate }>(`/api/v1/admin/email-templates/${key}`, {
    method: "PUT",
    body: input,
    withCsrf: true,
  });
  return res.data;
}

export async function previewTemplate(key: string, draft: UpdateTemplateInput): Promise<{ subject: string; html: string }> {
  const res = await apiFetch<{ data: { subject: string; html: string } }>(
    `/api/v1/admin/email-templates/${key}/preview`,
    { method: "POST", body: draft, withCsrf: true },
  );
  return res.data;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : null;
}

/** Multipart upload — apiFetch is JSON-only, so this posts FormData directly. */
export async function uploadTemplateImage(file: File): Promise<string> {
  await fetch(`${API_URL}/sanctum/csrf-cookie`, { credentials: "include" });
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${API_URL}/api/v1/admin/email-templates/image`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "X-XSRF-TOKEN": readCookie("XSRF-TOKEN") ?? "" },
    body: form,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "upload failed");
  return (await res.json()).data.url as string;
}
