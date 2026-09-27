import { apiFetch, apiDownload, apiText, apiUpload } from "./client";

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
  labels: Record<string, string> | null;
  footer_blocks: FooterBlock[] | null;
};

/** One footer fine-print column: a heading plus key→value lines. */
export type FooterBlock = {
  heading: string;
  lines: FooterLine[];
};

/** One line in a footer block; the label is optional ("label value"). */
export type FooterLine = {
  label: string | null;
  value: string;
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

/** Multipart logo upload (raw file or cropped blob). The contract returns `{ url }`. */
export async function uploadInvoiceLogo(file: Blob): Promise<{ url: string }> {
  const form = new FormData();
  const name = file instanceof File ? file.name : "logo.webp";
  form.append("image", file, name);
  const body = await apiUpload<{ url?: string; data?: { url?: string } }>(`${base}/image`, form);
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
  return apiText(`${base}/preview`);
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
