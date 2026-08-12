"use client";

import { useEffect, useState } from "react";
import { latnLocale } from "@/lib/utils";
import { toast } from "sonner";
import { Wallet, Clock, Download, ReceiptText, CheckCircle2, Loader2, AlertCircle, Package, Plus, Pencil, Trash2 } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import {
  getBillingSummary,
  listSubscriptionInvoices,
  exportSubscriptionInvoices,
  settleInvoice,
  listCompanies,
  listCollectorPayments,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  type SubscriptionInvoice,
  type CollectorPayment,
  type Plan,
} from "@/lib/api/admin";

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.subscriptions.${k}`);
  const { data: summary, refetch: refetchSummary } = useAsync(getBillingSummary);
  const { data: companiesData } = useAsync(listCompanies);
  const { data: plansData, refetch: refetchPlans } = useAsync(listPlans);
  const companies = companiesData ?? [];
  const plans = plansData ?? [];

  const [editingPlan, setEditingPlan] = useState<Plan | "new" | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);

  const [tenantId, setTenantId] = useState<number | undefined>(undefined);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [settling, setSettling] = useState<SubscriptionInvoice | null>(null);

  async function loadInvoices() {
    try {
      const r = await listSubscriptionInvoices(tenantId);
      setInvoices(r.data);
    } catch {
      setInvoices([]);
    }
  }

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const money = (n: number) => new Intl.NumberFormat(latnLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const maxRevenue = Math.max(1, ...(summary?.revenue_by_month.map((r) => r.total) ?? [0]));

  async function doDeletePlan() {
    if (!deletingPlan) return;
    setPlanBusy(true);
    try {
      await deletePlan(deletingPlan.id);
      toast.success(c("planDeleted"));
      await refetchPlans();
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setPlanBusy(false);
      setDeletingPlan(null);
    }
  }

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wallet} label={c("totalRevenue")} value={summary ? money(summary.totals.total_revenue) : "…"} tone="positive" />
        <StatCard icon={AlertCircle} label={c("outstanding")} value={summary ? money(summary.totals.outstanding) : "…"} tone={summary?.totals.outstanding ? "warning" : "default"} />
        <StatCard icon={CheckCircle2} label={c("activeSubs")} value={summary?.totals.active_subscriptions ?? "…"} tone="positive" />
        <StatCard icon={Clock} label={c("expiringSoon")} value={summary?.totals.expiring_soon ?? "…"} tone="warning" />
      </div>

      {/* Plans — resellers issue codes against these */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-slate-700" />
            <h3 className="font-semibold text-slate-800">{c("plansTitle")}</h3>
          </div>
          <Button variant="secondary" onClick={() => setEditingPlan("new")}>
            <Plus className="h-4 w-4" /> {c("addPlan")}
          </Button>
        </div>
        {plans.length === 0 ? (
          <p className="p-5 text-center text-sm text-slate-400">{c("noPlans")}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-slate-800">{p.name}</span>
                  {!p.active && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{c("planInactive")}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-semibold tabular-nums text-slate-800">{money(p.price)}</span>
                  <span className="tabular-nums text-slate-500">{p.duration_days} {c("planDays")}</span>
                  <button onClick={() => setEditingPlan(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => setDeletingPlan(p)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
                    <span className="text-slate-500">{e.ends_at ? new Date(e.ends_at).toLocaleDateString(latnLocale(locale)) : "—"}</span>
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
                  <th className="px-4 py-3 font-semibold">{c("colAmount")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStarts")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colEnds")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">#{inv.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{inv.company_name ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{inv.days}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-slate-800">{inv.amount !== null ? money(inv.amount) : "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold " +
                          (inv.paid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")
                        }
                      >
                        {inv.paid ? c("paid") : c("unpaid")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(inv.starts_at).toLocaleDateString(latnLocale(locale))}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(inv.ends_at).toLocaleDateString(latnLocale(locale))}</td>
                    <td className="px-4 py-3 text-end">
                      {!inv.paid && (
                        <button
                          onClick={() => setSettling(inv)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                        >
                          <CheckCircle2 className="h-4 w-4" /> {c("settle")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {settling && (
        <SettleModal
          invoice={settling}
          onClose={() => setSettling(null)}
          onSettled={async () => {
            await Promise.all([loadInvoices(), refetchSummary()]);
          }}
        />
      )}

      {editingPlan && (
        <PlanModal plan={editingPlan === "new" ? null : editingPlan} onClose={() => setEditingPlan(null)} onSaved={refetchPlans} />
      )}

      <ConfirmModal
        open={deletingPlan !== null}
        danger
        title={c("deletePlan")}
        message={c("deletePlanConfirm").replace("{name}", deletingPlan?.name ?? "")}
        confirmLabel={c("deletePlan")}
        cancelLabel={c("cancel")}
        busy={planBusy}
        onConfirm={doDeletePlan}
        onCancel={() => setDeletingPlan(null)}
      />
    </div>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.subscriptions.${k}`);
  const [name, setName] = useState(plan?.name ?? "");
  const [price, setPrice] = useState(plan ? String(plan.price) : "");
  const [days, setDays] = useState(plan ? String(plan.duration_days) : "30");
  const [active, setActive] = useState(plan?.active ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !(Number(days) > 0)) return;
    setBusy(true);
    try {
      const input = { name: name.trim(), price: Number(price) || 0, duration_days: Number(days), active };
      if (plan) await updatePlan(plan.id, input);
      else await createPlan(input);
      toast.success(c("planSaved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200";

  return (
    <Modal
      open
      onClose={onClose}
      title={plan ? c("editPlan") : c("addPlan")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{c("cancel")}</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{c("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-start">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{c("planName")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{c("planPrice")}</label>
            <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{c("planDuration")}</label>
            <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
          {c("planActive")}
        </label>
      </div>
    </Modal>
  );
}

function SettleModal({
  invoice,
  onClose,
  onSettled,
}: {
  invoice: SubscriptionInvoice;
  onClose: () => void;
  onSettled: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.subscriptions.${k}`);
  const [payments, setPayments] = useState<CollectorPayment[]>([]);
  const [paymentId, setPaymentId] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (n: number) => new Intl.NumberFormat(latnLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  useEffect(() => {
    // Only this company's payments can settle its invoice.
    listCollectorPayments({ tenant_id: invoice.tenant_id })
      .then((r) => setPayments(r.data))
      .catch(() => setPayments([]));
  }, [invoice.tenant_id]);

  async function save() {
    if (!paymentId) return;
    setBusy(true);
    try {
      await settleInvoice(invoice.id, Number(paymentId));
      toast.success(c("settled"));
      await onSettled();
      onClose();
    } catch (e) {
      toast.error(c("settleFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={c("settleTitle")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{c("cancel")}</Button>
          <Button onClick={save} disabled={busy || !paymentId}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{c("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-start">
        <p className="text-sm text-slate-500">{c("settleIntro")}</p>
        {payments.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">{c("noPayments")}</p>
        ) : (
          <Select
            value={paymentId}
            onChange={setPaymentId}
            placeholder={c("selectPayment")}
            options={payments.map((p) => ({
              value: String(p.id),
              label: `${money(p.amount)} · ${new Date(p.paid_on).toLocaleDateString(latnLocale(locale))} · ${p.collector_name ?? ""}`,
            }))}
          />
        )}
      </div>
    </Modal>
  );
}
