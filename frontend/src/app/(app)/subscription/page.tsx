"use client";

import { useState } from "react";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import { ReceiptText, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RedeemCodeModal } from "@/components/subscription/redeem-code-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getCompanySubscriptions, type CompanySubscriptionRow } from "@/lib/api/company-subscription";

const PERIOD_TONE: Record<CompanySubscriptionRow["period_status"], Status> = {
  active: "connected",
  scheduled: "expiring",
  ended: "neutral",
};

export default function CompanySubscriptionPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.codes.${k}`);
  const { data, loading, refetch } = useAsync(getCompanySubscriptions);
  const rows = data ?? [];

  const [open, setOpen] = useState(false);

  const money = (n: number | null) =>
    n === null ? "—" : new Intl.NumberFormat(latnLocale(locale), { style: "currency", currency: "EUR" }).format(n);
  const date = (iso: string) => toLatinDigits(new Date(iso).toLocaleDateString(latnLocale(locale)));

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="companySubscription"
        action={
          <Button onClick={() => setOpen(true)}>
            <KeyRound className="h-4 w-4" />
            {c("redeem")}
          </Button>
        }
      />

      <RedeemCodeModal open={open} onClose={() => setOpen(false)} onSuccess={refetch} />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title={c("empty")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colPlan")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCode")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCollector")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colAmount")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colPeriod")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3 font-medium text-ink">{r.plan ?? c("free")}</td>
                    <td className="px-4 py-3">
                      {r.code ? (
                        <span className="font-mono tracking-wider text-ink-muted" dir="ltr">{r.code}</span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{r.collector ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-ink">
                      {money(r.amount)}
                      <span className={`ms-1.5 text-xs ${r.paid ? "text-success-fg" : "text-ink-subtle"}`}>· {r.paid ? c("paid") : c("unpaid")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={PERIOD_TONE[r.period_status]}>{c(`st_${r.period_status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-start text-ink-muted whitespace-nowrap">
                      <span dir="ltr">{date(r.starts_at)} - {date(r.ends_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
