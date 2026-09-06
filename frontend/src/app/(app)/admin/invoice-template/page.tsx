"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Upload, ImageOff, ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";
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
  type FooterBlock,
} from "@/lib/api/invoice-template";

/** Absolute-ify a possibly-relative logo URL served by the backend. */
function resolveSrc(url: string | null | undefined): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${url}`;
}

/**
 * The overridable heading keys and their built-in German defaults, shown as the
 * placeholder of each label input. Kept in sync with InvoiceSettings::LABEL_DEFAULTS.
 */
const LABEL_KEYS = [
  "bill_to", "invoice_date", "period", "activation_code", "customer_no", "invoice_no",
  "description", "qty", "unit_price", "amount", "subtotal", "total",
  "paid", "paid_at", "payment_method", "sold_by", "contact", "tax_bank",
] as const;

const GERMAN_DEFAULTS: Record<string, string> = {
  bill_to: "Rechnung an", invoice_date: "Rechnungsdatum", period: "Leistungszeitraum",
  activation_code: "Aktivierungscode", customer_no: "Kunden-Nr.", invoice_no: "Rechnungs-Nr.",
  description: "Beschreibung", qty: "Menge", unit_price: "Einzelpreis", amount: "Betrag",
  subtotal: "Zwischensumme (netto)", total: "Gesamtbetrag", paid: "Bezahlt", paid_at: "Bezahlt am",
  payment_method: "Zahlungsart", sold_by: "Vermittelt von", contact: "Kontakt", tax_bank: "Steuer & Bank",
};

/**
 * Mirror of InvoiceSettings::defaultFooterBlocks() — when the server has no saved
 * footer_blocks (null), seed the editor from the flat issuer/bank fields so the
 * admin sees the current 3 default columns ready to edit (skipping empty lines).
 */
function deriveFooterBlocks(s: InvoiceSettings): FooterBlock[] {
  const contactHeading = s.labels?.contact?.trim() || GERMAN_DEFAULTS.contact;
  const taxBankHeading = s.labels?.tax_bank?.trim() || GERMAN_DEFAULTS.tax_bank;
  const line = (label: string | null, value: string | null | undefined) =>
    value && value.trim() !== "" ? [{ label, value }] : [];

  return [
    { heading: s.issuer_name ?? "", lines: [...line(null, s.issuer_address)] },
    {
      heading: contactHeading,
      lines: [...line(null, s.issuer_email), ...line(null, s.issuer_website), ...line(null, s.issuer_phone)],
    },
    {
      heading: taxBankHeading,
      lines: [
        ...line("USt-IdNr.", s.issuer_tax_id),
        ...line(null, s.bank_name),
        ...line("IBAN", s.bank_iban),
        ...line("BIC", s.bank_bic),
      ],
    },
  ];
}

/** Move the item at `i` one step in `dir` (-1 up, +1 down); no-op at the edges. */
function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
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
      .then((s) => {
        // When the server has never saved custom footer_blocks, seed them from the
        // issuer/bank fields so the admin sees the current 3 columns ready to edit.
        setSettings(s.footer_blocks ? s : { ...s, footer_blocks: deriveFooterBlocks(s) });
      })
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

  /** Write one heading override into the labels map (kept as a flat object). */
  function setLabel(key: string, value: string) {
    setSettings((prev) => (prev ? { ...prev, labels: { ...(prev.labels ?? {}), [key]: value } } : prev));
  }

  /** Replace the whole footer_blocks array with a transformed copy. */
  function setBlocks(update: (blocks: FooterBlock[]) => FooterBlock[]) {
    setSettings((prev) => (prev ? { ...prev, footer_blocks: update(prev.footer_blocks ?? []) } : prev));
  }

  const patchBlock = (idx: number, patch: Partial<FooterBlock>) =>
    setBlocks((blocks) => blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)));

  const patchLine = (bi: number, li: number, patch: Partial<FooterBlock["lines"][number]>) =>
    setBlocks((blocks) =>
      blocks.map((b, i) =>
        i === bi ? { ...b, lines: b.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) } : b,
      ),
    );

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
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
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
              <Field label={c("issuerTaxId")} value={settings.issuer_tax_id} onChange={(v) => set("issuer_tax_id", v)} placeholder="DE123456789" />
              <Field label={c("issuerPhone")} value={settings.issuer_phone} onChange={(v) => set("issuer_phone", v)} placeholder="+49 202 000000" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={c("issuerEmail")} value={settings.issuer_email} onChange={(v) => set("issuer_email", v)} placeholder="billing@firma.de" />
              <Field label={c("issuerWebsite")} value={settings.issuer_website} onChange={(v) => set("issuer_website", v)} placeholder="firma.de" />
            </div>
          </Section>

          {/* Bank */}
          <Section title={c("secBank")}>
            <Field label={c("bankName")} value={settings.bank_name} onChange={(v) => set("bank_name", v)} placeholder="Sparkasse Wuppertal" />
            <div className="grid grid-cols-2 gap-3">
              <Field label={c("bankIban")} value={settings.bank_iban} onChange={(v) => set("bank_iban", v)} placeholder="DE00 0000 0000 0000 00" />
              <Field label={c("bankBic")} value={settings.bank_bic} onChange={(v) => set("bank_bic", v)} placeholder="WELADEDXXX" />
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

          {/* Labels / headings — one override per fixed invoice heading. */}
          <Section title={c("secLabels")}>
            <p className="text-xs text-ink-muted">{c("labelsHint")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LABEL_KEYS.map((key) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-ink-muted">{c(`labelKeys.${key}`)}</label>
                  <input
                    value={settings.labels?.[key] ?? ""}
                    placeholder={GERMAN_DEFAULTS[key]}
                    onChange={(e) => setLabel(key, e.target.value)}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </Section>

          {/* Footer blocks — reorderable columns with reorderable label/value lines. */}
          <Section title={c("secFooterBlocks")}>
            <p className="text-xs text-ink-muted">{c("footerBlocksHint")}</p>
            {(settings.footer_blocks ?? []).map((block, bi) => (
              <div key={bi} className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={block.heading}
                    placeholder={c("blockHeading")}
                    onChange={(e) => patchBlock(bi, { heading: e.target.value })}
                    className={`${inputCls} font-medium`}
                  />
                  <IconBtn title={c("moveUp")} disabled={bi === 0} onClick={() => setBlocks((b) => move(b, bi, -1))}>
                    <ChevronUp className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn
                    title={c("moveDown")}
                    disabled={bi === (settings.footer_blocks?.length ?? 0) - 1}
                    onClick={() => setBlocks((b) => move(b, bi, 1))}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn title={c("removeBlock")} danger onClick={() => setBlocks((b) => b.filter((_, i) => i !== bi))}>
                    <Trash2 className="h-4 w-4" />
                  </IconBtn>
                </div>

                {block.lines.map((line, li) => (
                  <div key={li} className="flex items-center gap-2">
                    <input
                      value={line.label ?? ""}
                      placeholder={c("lineLabel")}
                      onChange={(e) => patchLine(bi, li, { label: e.target.value || null })}
                      className={`${inputCls} w-1/3`}
                    />
                    <input
                      value={line.value}
                      placeholder={c("lineValue")}
                      onChange={(e) => patchLine(bi, li, { value: e.target.value })}
                      className={inputCls}
                    />
                    <IconBtn
                      title={c("moveUp")}
                      disabled={li === 0}
                      onClick={() => patchBlock(bi, { lines: move(block.lines, li, -1) })}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      title={c("moveDown")}
                      disabled={li === block.lines.length - 1}
                      onClick={() => patchBlock(bi, { lines: move(block.lines, li, 1) })}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      title={c("removeLine")}
                      danger
                      onClick={() => patchBlock(bi, { lines: block.lines.filter((_, j) => j !== li) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconBtn>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => patchBlock(bi, { lines: [...block.lines, { label: null, value: "" }] })}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {c("addLine")}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setBlocks((b) => [...b, { heading: "", lines: [{ label: null, value: "" }] }])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" />
              {c("addBlock")}
            </button>
          </Section>
        </div>

        {/* Live preview */}
        <Card className="p-5 lg:sticky lg:top-6 lg:self-start">
          <h3 className="mb-3 text-sm font-semibold text-ink-muted">{c("preview")}</h3>
          <iframe title="invoice-preview" className="h-[720px] w-full rounded-lg border border-line bg-white" srcDoc={preview} />
        </Card>
      </div>

      {cropFile && (
        <ImageCropper file={cropFile} aspect={1} onCancel={() => setCropFile(null)} onCropped={onCropped} />
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

/** A small square icon button used for reorder/remove controls. */
function IconBtn({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-surface ${
        danger ? "text-danger-fg" : "text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={`${inputCls} resize-y`}
      />
    </div>
  );
}
