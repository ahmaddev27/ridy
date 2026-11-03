"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { toast } from "sonner";
import { Plus, Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { GlassPanel, type GlassVariant } from "@/components/ui/glass-panel";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PasswordInput } from "@/components/ui/password-input";
import { OtpInput } from "@/components/ui/otp-input";
import { Table, TableCard } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/context";

const swatches: [string, string, string][] = [
  ["swatchPrimary", "bg-primary", "slate-900"],
  ["swatchText", "bg-primary", "slate-900"],
  ["swatchMuted", "bg-slate-500", "slate-500"],
  ["swatchSurface", "border border-line bg-surface-2", "slate-50"],
  ["swatchMatched", "bg-emerald-500", "emerald-500"],
  ["swatchPersonal", "bg-rose-500", "rose-500"],
  ["swatchReview", "bg-amber-500", "amber-500"],
  ["swatchGap", "bg-slate-400", "slate-400"],
  ["swatchPrivate", "bg-violet-500", "violet-500"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </h3>
      {children}
    </Card>
  );
}

export default function DesignSystemPage() {
  // Internal component gallery — not part of the product in production builds.
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystemGallery />;
}

function DesignSystemGallery() {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [info, setInfo] = useState(false);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState("uber");
  const [sw, setSw] = useState(true);
  const [pw, setPw] = useState("");
  const [otp, setOtp] = useState("");

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="designSystem"
      />

      <GlassTestBed />

      {/* Colors */}
      <Section title={t("screens.designSystem.colorTokens")}>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {swatches.map(([nameKey, cls, token]) => (
            <div key={token}>
              <div className={`h-12 rounded-lg ${cls}`} />
              <p className="mt-1 text-xs font-medium">{t(`screens.designSystem.${nameKey}`)}</p>
              <p className="text-[10px] text-ink-subtle">{token}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Typography */}
        <Section title={t("screens.designSystem.typography")}>
          <div className="space-y-2">
            <p className="text-3xl font-bold text-ink">{t("screens.designSystem.heading1")}</p>
            <p className="text-2xl font-bold text-ink">{t("screens.designSystem.heading2")}</p>
            <p className="text-lg font-semibold text-ink">{t("screens.designSystem.heading3")}</p>
            <p className="text-sm text-ink-muted">{t("screens.designSystem.bodyText")}</p>
            <p className="text-xs text-ink-subtle">{t("screens.designSystem.captionText")}</p>
          </div>
        </Section>

        {/* Buttons */}
        <Section title={t("screens.designSystem.buttons")}>
          <div className="flex flex-wrap items-center gap-3">
            <Button>{t("screens.designSystem.btnPrimary")}</Button>
            <Button variant="secondary">{t("screens.designSystem.btnSecondary")}</Button>
            <Button variant="ghost">{t("screens.designSystem.btnGhost")}</Button>
            <Button variant="danger">{t("screens.designSystem.btnDanger")}</Button>
            <Button>
              <Plus className="h-4 w-4" /> {t("screens.designSystem.btnWithIcon")}
            </Button>
            <Button size="sm">{t("screens.designSystem.btnSmall")}</Button>
            <Button disabled>{t("screens.designSystem.btnDisabled")}</Button>
          </div>
        </Section>

        {/* Badges */}
        <Section title={t("screens.designSystem.badgesStatus")}>
          <div className="flex flex-wrap gap-2">
            <Badge status="matched">{t("screens.designSystem.badgeMatched")}</Badge>
            <Badge status="personal">{t("screens.designSystem.badgePersonal")}</Badge>
            <Badge status="ambiguous">{t("screens.designSystem.badgeAmbiguous")}</Badge>
            <Badge status="gap">{t("screens.designSystem.badgeGap")}</Badge>
            <Badge status="private">{t("screens.designSystem.badgePrivate")}</Badge>
            <Badge status="connected" dot>{t("screens.designSystem.badgeConnected")}</Badge>
            <Badge status="expiring" dot>{t("screens.designSystem.badgeExpiring")}</Badge>
            <Badge status="error" dot>{t("screens.designSystem.badgeError")}</Badge>
          </div>
        </Section>

        {/* Form controls — the shared input primitives (ui-field / --focus ring). */}
        <Section title={t("screens.designSystem.formControls")}>
          <div className="space-y-3">
            <SearchInput value={search} onChange={setSearch} placeholder={t("screens.designSystem.textInput")} className="max-w-none" />
            <Select
              value={sel}
              onChange={setSel}
              options={[
                { value: "uber", label: "Uber" },
                { value: "bolt", label: "Bolt" },
              ]}
            />
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
            <div className="flex flex-wrap items-center gap-5 text-sm text-ink-muted">
              <span className="flex items-center gap-2">
                {t("screens.designSystem.switchLabel")}
                <Switch checked={sw} onChange={() => setSw((v) => !v)} label={t("screens.designSystem.switchLabel")} />
              </span>
            </div>
            <OtpInput value={otp} onChange={setOtp} length={6} />
          </div>
        </Section>

        {/* Alerts */}
        <Section title={t("screens.designSystem.alertsBanners")}>
          <div className="space-y-2 text-sm">
            <Alert tone="info">{t("screens.designSystem.alertInfo")}</Alert>
            <Alert tone="success">{t("screens.designSystem.alertSuccess")}</Alert>
            <Alert tone="warning">{t("screens.designSystem.alertWarning")}</Alert>
            <Alert tone="error">{t("screens.designSystem.alertError")}</Alert>
          </div>
        </Section>

        {/* Toasts */}
        <Section title={t("screens.designSystem.toastsTitle")}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => toast.success(t("screens.designSystem.toastSuccessMsg"), { description: t("screens.designSystem.toastSuccessDesc") })}>{t("screens.designSystem.toastSuccess")}</Button>
            <Button size="sm" variant="danger" onClick={() => toast.error(t("screens.designSystem.toastErrorMsg"), { description: t("screens.designSystem.toastErrorDesc") })}>{t("screens.designSystem.toastError")}</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.warning(t("screens.designSystem.toastWarningMsg"), { description: t("screens.designSystem.toastWarningDesc") })}>{t("screens.designSystem.toastWarning")}</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.info(t("screens.designSystem.toastInfoMsg"), { description: t("screens.designSystem.toastInfoDesc") })}>{t("screens.designSystem.toastInfo")}</Button>
          </div>
        </Section>

        {/* Modals */}
        <Section title={t("screens.designSystem.modalsTitle")}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>{t("screens.designSystem.confirmDialog")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setInfo(true)}>{t("screens.designSystem.infoDialog")}</Button>
          </div>
        </Section>

        {/* Progress + skeleton */}
        <Section title={t("screens.designSystem.progressSkeleton")}>
          <div className="space-y-2">
            <div className="h-2 w-full rounded-full bg-surface-2"><div className="h-2 w-[70%] rounded-full bg-primary" /></div>
            <div className="h-2 w-full rounded-full bg-surface-2"><div className="h-2 w-[40%] rounded-full bg-emerald-500" /></div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        </Section>

        {/* Empty state */}
        <Section title={t("screens.designSystem.emptyStateTitle")}>
          <EmptyState
            icon={Inbox}
            title={t("screens.designSystem.emptyTitle")}
            description={t("screens.designSystem.emptyDesc")}
          />
        </Section>

        {/* Shared data table (ui-table — solid, sticky header, tabular-nums) */}
        <Section title="Data table">
          <TableCard>
            <Table>
              <thead>
                <tr>
                  <th>Fahrer</th>
                  <th>Status</th>
                  <th className="r">Umsatz</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Ahmed Jaber</td>
                  <td><Badge status="connected" dot>Online</Badge></td>
                  <td className="r tabular-nums">1.234,56 €</td>
                </tr>
                <tr>
                  <td>Maria Schmidt</td>
                  <td><Badge status="gap">Offline</Badge></td>
                  <td className="r tabular-nums">987,00 €</td>
                </tr>
                <tr>
                  <td>Jonas Weber</td>
                  <td><Badge status="expiring" dot>Ablaufend</Badge></td>
                  <td className="r tabular-nums">2.045,10 €</td>
                </tr>
              </tbody>
            </Table>
          </TableCard>
        </Section>

        {/* Tabs + pagination */}
        <Section title={t("screens.designSystem.tabsPagination")}>
          <div className="flex gap-5 border-b border-line text-sm">
            <button className="border-b-2 border-ink pb-2 font-semibold text-ink">{t("screens.designSystem.tabActive")}</button>
            <button className="border-b-2 border-transparent pb-2 font-semibold text-ink-muted">{t("screens.designSystem.tabTwo")}</button>
            <button className="border-b-2 border-transparent pb-2 font-semibold text-ink-muted">{t("screens.designSystem.tabThree")}</button>
          </div>
          <div className="mt-4 flex items-center gap-1 text-sm">
            <button className="rounded-md border border-line px-2.5 py-1 text-ink-muted hover:bg-surface-2">‹</button>
            <button className="rounded-md bg-primary px-2.5 py-1 text-primary-ink">1</button>
            <button className="rounded-md border border-line px-2.5 py-1 text-ink-muted hover:bg-surface-2">2</button>
            <button className="rounded-md border border-line px-2.5 py-1 text-ink-muted hover:bg-surface-2">3</button>
            <button className="rounded-md border border-line px-2.5 py-1 text-ink-muted hover:bg-surface-2">›</button>
          </div>
        </Section>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("screens.designSystem.confirmModalTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>{t("screens.designSystem.cancel")}</Button>
            <Button variant="danger" onClick={() => { toast.success(t("screens.designSystem.flagDismissed")); setConfirm(false); }}>{t("screens.designSystem.dismiss")}</Button>
          </>
        }
      >
        {t("screens.designSystem.confirmModalBody")}
      </Modal>

      <Modal
        open={info}
        onClose={() => setInfo(false)}
        title={t("screens.designSystem.infoModalTitle")}
        footer={<Button onClick={() => setInfo(false)}>{t("screens.designSystem.gotIt")}</Button>}
      >
        {t("screens.designSystem.infoModalBody")}
      </Modal>
    </div>
  );
}

function Alert({
  tone,
  children,
}: {
  tone: "info" | "success" | "warning" | "error";
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-line-strong bg-surface-2 text-indigo-800",
    success: "border-emerald-200 bg-success-bg text-emerald-800",
    warning: "border-amber-200 bg-warning-bg text-amber-800",
    error: "border-rose-200 bg-danger-bg text-rose-800",
  }[tone];
  return <div className={`rounded-lg border p-3 ${styles}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Glass redesign test bed (epic #276, Phase 0). Dev-only like the rest of this
// page. Static showcase of the glass tokens and primitives.
// ---------------------------------------------------------------------------
const TOKEN_GROUPS: { label: string; tokens: string[] }[] = [
  { label: "Surfaces", tokens: ["canvas", "surface", "surface-solid", "surface-2", "surface-3"] },
  { label: "Ink", tokens: ["ink", "ink-muted", "ink-subtle", "line", "line-strong"] },
  { label: "Brand", tokens: ["primary", "primary-hover", "primary-soft", "primary-soft-ink", "focus"] },
  { label: "Success / Danger", tokens: ["success-bg", "success-fg", "success-dot", "danger-bg", "danger-fg", "danger-dot"] },
  { label: "Warning / Info", tokens: ["warning-bg", "warning-fg", "warning-dot", "info-bg", "info-fg", "info-dot"] },
  { label: "Accent / Neutral", tokens: ["accent-bg", "accent-fg", "accent-dot", "neutral-bg", "neutral-fg", "neutral-dot"] },
  { label: "Charts", tokens: ["c1", "c2", "c3", "c4", "c5"] },
];

const GLASS_VARIANTS: [GlassVariant, string][] = [
  ["card", "card: translucent, edge + highlight, no blur"],
  ["sheet", "sheet: blur(22px) saturate(160%)"],
  ["strong", "strong: blur(26px) saturate(180%)"],
  ["solid", "solid: dense data, opaque"],
];

const RADII = ["xs", "sm", "md", "lg", "xl", "2xl"];

function GlassTestBed() {
  return (
    <Section title="Glass design (epic #276)">
      <div className="space-y-6">
        <div className="space-y-3">
          {TOKEN_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="mb-1 text-xs font-medium text-ink-muted">{g.label}</p>
              <div className="flex flex-wrap gap-2">
                {g.tokens.map((tk) => (
                  <div key={tk} className="w-24">
                    <div
                      className="h-9 rounded-lg border border-line-strong"
                      style={{ background: `var(--${tk})` }}
                    />
                    <p className="mt-1 truncate text-[10px] text-ink-subtle">--{tk}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">GlassPanel variants (over the ambient field)</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {GLASS_VARIANTS.map(([variant, label]) => (
              <GlassPanel key={variant} variant={variant} className="p-4">
                <p className="text-sm font-semibold text-ink">{variant}</p>
                <p className="mt-1 text-xs text-ink-muted">{label}</p>
                <p className="mt-2 text-xs text-ink-subtle tabular-nums">1.234,56 € · 12,4 km</p>
              </GlassPanel>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">Fonts</p>
            <p className="font-sans text-lg">Geist: Fahrer, Fahrzeuge 0123456789 €</p>
            <p className="mono text-sm">Geist Mono: DE-AB 1234 · 0123456789</p>
            <p className="text-lg" lang="ar" dir="rtl" style={{ fontFamily: "var(--font-ar)" }}>
              IBM Plex Sans Arabic: السائقون والمركبات 0123456789 € 12.5 km
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">Radii</p>
            <div className="flex flex-wrap gap-2">
              {RADII.map((r) => (
                <div
                  key={r}
                  className="flex h-12 w-14 items-center justify-center border border-line-strong bg-surface-2 text-[10px] text-ink-muted"
                  style={{ borderRadius: `var(--r-${r}, 8px)` }}
                >
                  {r}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
