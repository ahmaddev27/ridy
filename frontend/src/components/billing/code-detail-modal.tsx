"use client";

import { Modal } from "@/components/ui/modal";
import { Badge, type Status } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import type { InvoiceCode } from "@/lib/api/admin";

const STATUS_TONE: Record<InvoiceCode["status"], Status> = {
  activated: "matched",
  pending: "expiring",
  expired: "error",
};

/** Read-only detail of the activation code behind an invoice. */
export function CodeDetailModal({
  code,
  company,
  onClose,
}: {
  code: InvoiceCode | null;
  company?: string | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.subscriptions.${k}`);

  if (!code) return null;

  const money = (n: number | null) =>
    n === null ? "—" : new Intl.NumberFormat(latnLocale(locale), { style: "currency", currency: "EUR" }).format(n);
  const dateTime = (iso: string | null) =>
    iso ? toLatinDigits(new Date(iso).toLocaleString(latnLocale(locale))) : "—";
  const date = (iso: string | null) => (iso ? toLatinDigits(new Date(iso).toLocaleDateString(latnLocale(locale))) : "—");

  const rows: [string, React.ReactNode][] = [
    [c("codePlan"), code.plan ?? "—"],
    [c("codeCompany"), company ?? "—"],
    [c("codeCollector"), code.collector ?? "—"],
    [c("codeAmount"), <span key="a" className="tabular-nums">{money(code.amount)} · {code.paid ? c("paid") : c("unpaid")}</span>],
    [c("codeCreated"), dateTime(code.created_at)],
    [c("codeActivated"), date(code.activated_at)],
    [c("codeExpires"), dateTime(code.expires_at)],
  ];

  return (
    <Modal open onClose={onClose} title={c("codeDetailTitle")}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
          <span className="font-mono text-2xl font-bold tracking-[0.2em] text-ink" dir="ltr">{code.code}</span>
          <Badge status={STATUS_TONE[code.status]}>{c(`st_${code.status}`)}</Badge>
        </div>
        <dl className="divide-y divide-line text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-end font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}
