"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Clock, Download, ReceiptText } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import {
  getBillingSummary,
  listSubscriptionInvoices,
  exportSubscriptionInvoices,
  listCompanies,
  type SubscriptionInvoice,
} from "@/lib/api/admin";

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.subscriptions.${k}`);
  const { data: summary } = useAsync(getBillingSummary);
  const { data: companiesData } = useAsync(listCompanies);
  const companies = companiesData ?? [];

  const [tenantId, setTenantId] = useState<number | undefined>(undefined);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);

  useEffect(() => {
    listSubscriptionInvoices(tenantId).then((r) => setInvoices(r.data)).catch(() => setInvoices([]));
  }, [tenantId]);

  const money = (n: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const maxRevenue = Math.max(1, ...(summary?.revenue_by_month.map((r) => r.total) ?? [0]));

  async function doExport() {
    try {
      const blob = await exportSubscriptionInvoices(tenantId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "subscription-invoices.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(c("exportFailed"), { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader tkey="subscriptions" />

      {/* Headline totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={c("totalRevenue")} value={summary ? money(summary.totals.total_revenue) : "…"} tone="positive" />
        <StatCard label={c("activeSubs")} value={summary?.totals.active_subscriptions ?? "…"} />
        <StatCard label={c("expiringSoon")} value={summary?.totals.expiring_soon ?? "…"} tone="warning" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue by month */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-slate-700" />
            <h3 className="font-semibold text-slate-800">{c("revenueTitle")}</h3>
          </div>
          {!summary || summary.revenue_by_month.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">{c("revenueEmpty")}</p>
          ) : (
            <div className="space-y-2.5">
              {summary.revenue_by_month.map((r) => (
                <div key={r.month} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs tabular-nums text-slate-500">{r.month}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(r.total / maxRevenue) * 100}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-end text-xs font-semibold tabular-nums text-slate-700">{money(r.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Expiring subscriptions */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-700" />
            <h3 className="font-semibold text-slate-800">{c("expiringTitle")}</h3>
          </div>
          {!summary || summary.expiring.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">{c("expiringEmpty")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {summary.expiring.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-slate-800">{e.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-slate-500">{e.ends_at ? new Date(e.ends_at).toLocaleDateString(locale) : "—"}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      {c("daysLeft").replace("{n}", String(e.days_left ?? 0))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Invoices */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <h3 className="font-semibold text-slate-800">{c("invoicesTitle")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-52"
              value={tenantId ? String(tenantId) : ""}
              onChange={(v) => setTenantId(v ? Number(v) : undefined)}
              options={[{ value: "", label: c("filterCompany") }, ...companies.map((co) => ({ value: String(co.id), label: co.name }))]}
            />
            <Button variant="secondary" onClick={doExport} disabled={invoices.length === 0}>
              <Download className="h-4 w-4" /> {c("exportExcel")}
            </Button>
          </div>
        </div>

        {invoices.length === 0 ? (
          <EmptyState icon={ReceiptText} title={c("invoicesEmpty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colInvoice")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCompany")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colDays")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStarts")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colEnds")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">#{inv.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{inv.company_name ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{inv.days}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(inv.starts_at).toLocaleDateString(locale)}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(inv.ends_at).toLocaleDateString(locale)}</td>
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
