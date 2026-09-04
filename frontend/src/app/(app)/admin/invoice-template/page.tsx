"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Upload, ImageOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ImageCropper } from "@/components/ads/image-cropper";
import { useI18n } from "@/lib/i18n/context";
import {
  getInvoiceTemplate,
  saveInvoiceTemplate,
  uploadInvoiceLogo,
  fetchInvoicePreview,
  type InvoiceSettings,
  type InvoiceSettingsInput,
} from "@/lib/api/invoice-template";

/** Absolute-ify a possibly-relative logo URL served by the backend. */
function resolveSrc(url: string | null | undefined): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${url}`;
}

export default function InvoiceTemplatePage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.invoiceTemplate.${k}`);

  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  useEffect(() => {
    getInvoiceTemplate()
      .then(setSettings)
      .catch(() => toast.error(c("loadFailed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced live preview. The preview route renders the SAVED settings, so
  // fetchInvoicePreview persists the current form values first — typing thus
  // auto-saves (debounced), and the explicit Save button only adds a toast.
  useEffect(() => {
    if (!settings) return;
    const id = setTimeout(() => {
      fetchInvoicePreview(settings)
        .then(setPreview)
        .catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [settings]);

  function set<K extends keyof InvoiceSettingsInput>(key: K, value: InvoiceSettingsInput[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setCropFile(file);
  }

  async function onCropped(blob: Blob) {
    setCropFile(null);
    setUploading(true);
    try {
      const { url } = await uploadInvoiceLogo(blob);
      set("logo_url", url);
    } catch (err) {
      toast.error(c("uploadFailed"), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      const updated = await saveInvoiceTemplate(settings);
      setSettings(updated);
      toast.success(c("saved"));
    } catch (err) {
      toast.error(c("saveFailed"), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <PageHeader tkey="invoiceTemplate" />
        <div className="flex justify-center py-20 text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  const logoSrc = resolveSrc(settings.logo_url);

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="invoiceTemplate"
        action={
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editor form */}
        <div className="space-y-6">
          {/* Branding */}
          <Section title={c("secBranding")}>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">{c("logo")}</label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
                  {logoSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoSrc} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImageOff className="h-5 w-5 text-ink-subtle" />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-2">
                    <input type="file" accept="image/*" className="hidden" onChange={onPickLogo} disabled={uploading} />
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {settings.logo_url ? c("changeLogo") : c("uploadLogo")}
                  </label>
                  {settings.logo_url && (
                    <button
                      type="button"
                      onClick={() => set("logo_url", null)}
                      className="text-start text-xs text-danger-fg hover:underline"
                    >
                      {c("removeLogo")}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">{c("accentColor")}</label>
              <input
                type="color"
                value={settings.accent_color || "#4f46e5"}
                onChange={(e) => set("accent_color", e.target.value)}
                className="h-9 w-full rounded-lg border border-line-strong"
              />
            </div>
          </Section>

          {/* Issuer */}
          <Section title={c("secIssuer")}>
            <Field label={c("issuerName")} value={settings.issuer_name} onChange={(v) => set("issuer_name", v)} />
            <TextArea label={c("issuerAddress")} value={settings.issuer_address} onChange={(v) => set("issuer_address", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={c("issuerTaxId")} value={settings.issuer_tax_id} onChange={(v) => set("issuer_tax_id", v)} />
              <Field label={c("issuerPhone")} value={settings.issuer_phone} onChange={(v) => set("issuer_phone", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={c("issuerEmail")} value={settings.issuer_email} onChange={(v) => set("issuer_email", v)} />
              <Field label={c("issuerWebsite")} value={settings.issuer_website} onChange={(v) => set("issuer_website", v)} />
            </div>
          </Section>

          {/* Bank */}
          <Section title={c("secBank")}>
            <Field label={c("bankName")} value={settings.bank_name} onChange={(v) => set("bank_name", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={c("bankIban")} value={settings.bank_iban} onChange={(v) => set("bank_iban", v)} />
              <Field label={c("bankBic")} value={settings.bank_bic} onChange={(v) => set("bank_bic", v)} />
            </div>
          </Section>

          {/* Content */}
          <Section title={c("secContent")}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={c("invoiceTitle")} value={settings.invoice_title} onChange={(v) => set("invoice_title", v)} />
              <Field label={c("numberPrefix")} value={settings.number_prefix} onChange={(v) => set("number_prefix", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">{c("vatRate")}</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={String(settings.vat_rate)}
                  onChange={(e) => set("vat_rate", Number(e.target.value) || 0)}
                  disabled={settings.kleinunternehmer}
                  className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line disabled:opacity-50"
                />
              </div>
              <Field label={c("currency")} value={settings.currency} onChange={(v) => set("currency", v)} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={settings.kleinunternehmer}
                onChange={(e) => set("kleinunternehmer", e.target.checked)}
                className="h-4 w-4"
              />
              {c("kleinunternehmer")}
            </label>
          </Section>

          {/* Texts */}
          <Section title={c("secTexts")}>
            <TextArea label={c("headerNote")} value={settings.header_note} onChange={(v) => set("header_note", v)} />
            <TextArea label={c("footerThanks")} value={settings.footer_thanks} onChange={(v) => set("footer_thanks", v)} />
            <TextArea label={c("footerTerms")} value={settings.footer_terms} onChange={(v) => set("footer_terms", v)} />
          </Section>
        </div>

        {/* Live preview */}
        <Card className="p-5 lg:sticky lg:top-6 lg:self-start">
          <h3 className="mb-3 text-sm font-semibold text-ink-muted">{c("preview")}</h3>
          <iframe title="invoice-preview" className="h-[720px] w-full rounded-lg border border-line bg-white" srcDoc={preview} />
        </Card>
      </div>

      {cropFile && (
        <ImageCropper file={cropFile} aspect={3 / 1} onCancel={() => setCropFile(null)} onCropped={onCropped} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </Card>
  );
}

const inputCls =
  "w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line";

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={`${inputCls} resize-y`}
      />
    </div>
  );
}
