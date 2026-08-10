"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";

const swatches: [string, string, string][] = [
  ["swatchPrimary", "bg-slate-900", "slate-900"],
  ["swatchText", "bg-slate-900", "slate-900"],
  ["swatchMuted", "bg-slate-500", "slate-500"],
  ["swatchSurface", "border border-slate-200 bg-slate-50", "slate-50"],
  ["swatchMatched", "bg-emerald-500", "emerald-500"],
  ["swatchPersonal", "bg-rose-500", "rose-500"],
  ["swatchReview", "bg-amber-500", "amber-500"],
  ["swatchGap", "bg-slate-400", "slate-400"],
  ["swatchPrivate", "bg-violet-500", "violet-500"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </Card>
  );
}

export default function DesignSystemPage() {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [info, setInfo] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="designSystem"
      />

      {/* Colors */}
      <Section title={t("screens.designSystem.colorTokens")}>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {swatches.map(([nameKey, cls, token]) => (
            <div key={token}>
              <div className={`h-12 rounded-lg ${cls}`} />
              <p className="mt-1 text-xs font-medium">{t(`screens.designSystem.${nameKey}`)}</p>
              <p className="text-[10px] text-slate-400">{token}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Typography */}
        <Section title={t("screens.designSystem.typography")}>
          <div className="space-y-2">
            <p className="text-3xl font-bold text-slate-900">{t("screens.designSystem.heading1")}</p>
            <p className="text-2xl font-bold text-slate-900">{t("screens.designSystem.heading2")}</p>
            <p className="text-lg font-semibold text-slate-800">{t("screens.designSystem.heading3")}</p>
            <p className="text-sm text-slate-600">{t("screens.designSystem.bodyText")}</p>
            <p className="text-xs text-slate-400">{t("screens.designSystem.captionText")}</p>
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

        {/* Form controls */}
        <Section title={t("screens.designSystem.formControls")}>
          <div className="space-y-3">
            <input
              placeholder={t("screens.designSystem.textInput")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            />
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900">
              <option>{t("screens.designSystem.selectOption")}</option>
              <option>Uber</option>
              <option>Bolt</option>
            </select>
            <div className="flex flex-wrap items-center gap-5 text-sm text-slate-600">
              <label className="flex items-center gap-2">
                <input type="checkbox" defaultChecked className="rounded border-slate-300 text-slate-900" />
                {t("screens.designSystem.checkbox")}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="dsr" defaultChecked className="border-slate-300 text-slate-900" />
                {t("screens.designSystem.radio")}
              </label>
              <span className="flex items-center gap-2">
                {t("screens.designSystem.switchLabel")}
                <span className="inline-flex h-5 w-9 items-center rounded-full bg-emerald-500 p-0.5">
                  <span className="ml-auto h-4 w-4 rounded-full bg-white" />
                </span>
              </span>
            </div>
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
            <div className="h-2 w-full rounded-full bg-slate-100"><div className="h-2 w-[70%] rounded-full bg-slate-900" /></div>
            <div className="h-2 w-full rounded-full bg-slate-100"><div className="h-2 w-[40%] rounded-full bg-emerald-500" /></div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
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

        {/* Tabs + pagination */}
        <Section title={t("screens.designSystem.tabsPagination")}>
          <div className="flex gap-5 border-b border-slate-200 text-sm">
            <button className="border-b-2 border-slate-900 pb-2 font-semibold text-slate-800">{t("screens.designSystem.tabActive")}</button>
            <button className="border-b-2 border-transparent pb-2 font-semibold text-slate-500">{t("screens.designSystem.tabTwo")}</button>
            <button className="border-b-2 border-transparent pb-2 font-semibold text-slate-500">{t("screens.designSystem.tabThree")}</button>
          </div>
          <div className="mt-4 flex items-center gap-1 text-sm">
            <button className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-50">‹</button>
            <button className="rounded-md bg-slate-900 px-2.5 py-1 text-white">1</button>
            <button className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-50">2</button>
            <button className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-50">3</button>
            <button className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-50">›</button>
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
    info: "border-slate-300 bg-slate-100 text-indigo-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];
  return <div className={`rounded-lg border p-3 ${styles}`}>{children}</div>;
}
