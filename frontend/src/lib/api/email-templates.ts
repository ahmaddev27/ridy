import { apiFetch, apiUpload } from "./client";

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

/** Multipart upload of an inline template image; returns its public URL. */
export async function uploadTemplateImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const res = await apiUpload<{ data: { url: string } }>("/api/v1/admin/email-templates/image", form);
  return res.data.url;
}
