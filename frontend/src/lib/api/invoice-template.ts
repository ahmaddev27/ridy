import { apiFetch, apiDownload } from "./client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Super-admin invoice branding + issuer/bank/tax details used to render the
 *  subscription-invoice PDFs. Mirrors the backend `InvoiceSettings` payload. */
export type InvoiceSettings = {
  issuer_name: string;
  issuer_address: string;
  issuer_tax_id: string;
  issuer_email: string;
  issuer_phone: string;
  issuer_website: string;
  bank_iban: string;
  bank_bic: string;
  bank_name: string;
  logo_url: string | null;
  accent_color: string;
  invoice_title: string;
  number_prefix: string;
  vat_rate: number;
  kleinunternehmer: boolean;
  currency: string;
  header_note: string;
  footer_thanks: string;
  footer_terms: string;
};

/** The editable slice sent on save — every field the form controls. */
export type InvoiceSettingsInput = Omit<InvoiceSettings, "logo_url"> & {
  logo_url?: string | null;
};

const base = "/api/v1/admin/invoice-template";

export async function getInvoiceTemplate(): Promise<InvoiceSettings> {
  const res = await apiFetch<{ data: InvoiceSettings }>(base);
  return res.data;
}

export async function saveInvoiceTemplate(payload: InvoiceSettingsInput): Promise<InvoiceSettings> {
  const res = await apiFetch<{ data: InvoiceSettings }>(base, {
    method: "PUT",
    body: payload,
    withCsrf: true,
  });
  return res.data;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : null;
}

/** Multipart logo upload (raw file or cropped blob). The contract returns `{ url }`. */
export async function uploadInvoiceLogo(file: Blob): Promise<{ url: string }> {
  await fetch(`${API_URL}/sanctum/csrf-cookie`, { credentials: "include" });
  const form = new FormData();
  const name = file instanceof File ? file.name : "logo.webp";
  form.append("image", file, name);
  const res = await fetch(`${API_URL}${base}/image`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "X-XSRF-TOKEN": readCookie("XSRF-TOKEN") ?? "" },
    body: form,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "upload failed");
  const body = await res.json();
  // Contract: `{ url }`. Stay tolerant of a `{ data: { url } }` envelope too.
  return { url: (body.url ?? body.data?.url) as string };
}

/**
 * Live preview of the CURRENT (possibly unsaved) form values.
 *
 * The backend preview route is GET-only and renders the SAVED settings with
 * sample data, so previewing unsaved edits means persisting them first. We
 * therefore save the payload, then fetch the freshly-rendered HTML. Callers
 * debounce this so typing doesn't hammer the endpoint.
 */
export async function fetchInvoicePreview(payload: InvoiceSettingsInput): Promise<string> {
  await saveInvoiceTemplate(payload);
  const res = await fetch(`${API_URL}${base}/preview`, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!res.ok) throw new Error("preview failed");
  return res.text();
}

/** Download the rendered PDF for one subscription invoice as `{invoice}.pdf`. */
export async function downloadInvoicePdf(invoiceId: number): Promise<void> {
  const blob = await apiDownload(`/api/v1/admin/subscription-invoices/${invoiceId}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoiceId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
