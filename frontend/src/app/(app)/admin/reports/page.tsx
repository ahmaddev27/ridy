"use client";

import { useEffect, useRef, useState } from "react";
import { latnLocale } from "@/lib/utils";
import { toast } from "sonner";
import { Wallet, Clock, Download, ReceiptText, CheckCircle2, Loader2, AlertCircle, Package, Plus, Pencil, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Select } from "@/components/ui/select";
import { CodeDetailModal } from "@/components/billing/code-detail-modal";
import { paymentMethodLabel } from "@/lib/api/payments";
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
import { downloadInvoicePdf } from "@/lib/api/invoice-template";
import { apiErrorMessage } from "@/lib/api/error-message";

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
  const [codeDetail, setCodeDetail] = useState<SubscriptionInvoice | null>(null);

  // Code lifecycle → badge tone (matches the code-detail modal).
  const CODE_TONE: Record<NonNullable<SubscriptionInvoice["code"]>["status"], string> = {
    activated: "success",
    pending: "warning",
    expired: "danger",
  };

  // Paged: older (incl. unpaid, still-to-settle) invoices stay reachable.
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceMeta, setInvoiceMeta] = useState<{ last_page: number; total: number } | null>(null);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const invoiceSeq = useRef(0);

  async function loadInvoices() {
    const my = ++invoiceSeq.current;
    try {
      const r = await listSubscriptionInvoices({ tenantId, page: invoicePage, perPage: 50 });
      if (my !== invoiceSeq.current) return;
      setInvoices(r.data);
      setInvoiceMeta({ last_page: r.meta.last_page, total: r.meta.total });
    } catch {
      if (my === invoiceSeq.current) setInvoices([]);
    } finally {
      if (my === invoiceSeq.current) setInvoicesLoaded(true);
    }
  }

  useEffect(() => {
    setInvoicePage(1);
  }, [tenantId]);

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, invoicePage]);

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
      toast.error(c("failed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setPlanBusy(false);
      setDeletingPlan(null);
    }
  }

  async function doDownloadPdf(invoiceId: number) {
    try {
      await downloadInvoicePdf(invoiceId);
    } catch (e) {
      toast.error(c("pdfFailed"), { description: apiErrorMessage(e, t, locale) });
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
      toast.error(c("exportFailed"), { description: apiErrorMessage(e, t, locale) });
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader tkey="subscriptions" />

      {/* Headline totals */}
      <div className="g-4">
        <Stat icon={Wallet} tone="success" label={c("totalRevenue")} value={summary ? money(summary.totals.total_revenue) : "…"} />
        <Stat
          icon={AlertCircle}
          tone={summary?.totals.outstanding ? "warning" : undefined}
          label={c("outstanding")}
          value={summary ? money(summary.totals.outstanding) : "…"}
        />
        <Stat icon={CheckCircle2} tone="success" label={c("activeSubs")} value={summary?.totals.active_subscriptions ?? "…"} />
        <Stat icon={Clock} tone="warning" label={c("expiringSoon")} value={summary?.totals.expiring_soon ?? "…"} />
      </div>

      {/* Plans — resellers issue codes against these */}
      <section className="card">
        <div className="card-head">
          <h2 className="row" style={{ gap: 8 }}>
            <span className="subtle"><Package style={{ width: 18, height: 18 }} /></span>
            {c("plansTitle")}
          </h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingPlan("new")}>
            <Plus /> {c("addPlan")}
          </button>
        </div>
        {plans.length === 0 ? (
          <div className="empty">
            <span className="empty-ico"><Package /></span>
            <h3>{c("noPlans")}</h3>
          </div>
        ) : (
          <ul className="list-rows" style={{ margin: "14px 0 0", padding: 0, listStyle: "none" }}>
            {plans.map((p) => (
              <li key={p.id} className="list-row">
                <div className="grow row" style={{ gap: 8 }}>
                  <span className="strong">{p.name}</span>
                  {!p.active && <span className="badge">{c("planInactive")}</span>}
                </div>
                <span className="num strong">{money(p.price)}</span>
                <span className="num subtle" style={{ minWidth: 64, textAlign: "end" }}>{p.duration_days} {c("planDays")}</span>
                <div className="row" style={{ gap: 2 }}>
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" title={c("editPlan")} aria-label={c("editPlan")} onClick={() => setEditingPlan(p)}>
                    <Pencil />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: "var(--danger-fg)" }} title={c("deletePlan")} aria-label={c("deletePlan")} onClick={() => setDeletingPlan(p)}>
                    <Trash2 />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="g-2" style={{ alignItems: "start" }}>
        {/* Revenue by month */}
        <section className="card">
          <div className="card-head">
            <h2 className="row" style={{ gap: 8 }}>
              <span className="subtle"><Wallet style={{ width: 18, height: 18 }} /></span>
              {c("revenueTitle")}
            </h2>
          </div>
          <div className="card-body">
            {!summary || summary.revenue_by_month.length === 0 ? (
              <div className="empty">
                <span className="empty-ico"><Wallet /></span>
                <h3>{c("revenueEmpty")}</h3>
              </div>
            ) : (
              <div className="stack-sm" style={{ gap: 12 }}>
                {summary.revenue_by_month.map((r) => (
                  <div key={r.month} className="row" style={{ gap: 12 }}>
                    <span className="subtle num text-sm" style={{ width: 64, flexShrink: 0 }}>{r.month}</span>
                    <div className="grow" style={{ height: 12, borderRadius: 99, background: "var(--surface-3)", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 99, background: "var(--c1)", width: `${(r.total / maxRevenue) * 100}%` }} />
                    </div>
                    <span className="num strong text-sm" style={{ width: 84, flexShrink: 0, textAlign: "end" }}>{money(r.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Expiring subscriptions */}
        <section className="card">
          <div className="card-head">
            <h2 className="row" style={{ gap: 8 }}>
              <span className="subtle"><Clock style={{ width: 18, height: 18 }} /></span>
              {c("expiringTitle")}
            </h2>
          </div>
          {!summary || summary.expiring.length === 0 ? (
            <div className="empty">
              <span className="empty-ico"><Clock /></span>
              <h3>{c("expiringEmpty")}</h3>
            </div>
          ) : (
            <ul className="list-rows" style={{ margin: "14px 0 0", padding: 0, listStyle: "none" }}>
              {summary.expiring.map((e) => (
                <li key={e.id} className="list-row">
                  <div className="grow">
                    <div className="strong">{e.name}</div>
                    <div className="subtle text-xs num">{e.ends_at ? new Date(e.ends_at).toLocaleDateString(latnLocale(locale)) : "—"}</div>
                  </div>
                  <span className="badge warning">
                    <span className="dot" />
                    {c("daysLeft").replace("{n}", String(e.days_left ?? 0))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Invoices */}
      <section className="card table-card">
        <div className="card-head" style={{ paddingBottom: 14 }}>
          <h2 className="row" style={{ gap: 8 }}>
            <span className="subtle"><ReceiptText style={{ width: 18, height: 18 }} /></span>
            {c("invoicesTitle")}
          </h2>
          <div className="row-wrap">
            <Select
              className="w-52"
              value={tenantId ? String(tenantId) : ""}
              onChange={(v) => setTenantId(v ? Number(v) : undefined)}
              options={[{ value: "", label: c("filterCompany") }, ...companies.map((co) => ({ value: String(co.id), label: co.name }))]}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={doExport} disabled={invoices.length === 0}>
              <Download /> {c("exportExcel")}
            </button>
          </div>
        </div>

        {!invoicesLoaded ? (
          <div className="stack-sm" style={{ padding: 18 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel" style={{ height: 40, borderRadius: 8 }} />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="empty">
            <span className="empty-ico"><ReceiptText /></span>
            <h3>{c("invoicesEmpty")}</h3>
          </div>
        ) : (
          <div className="overflow-x-auto" style={{ borderTop: "1px solid var(--line)" }}>
            <Table>
              <thead>
                <tr>
                  <th>{c("colInvoice")}</th>
                  <th>{c("colCompany")}</th>
                  <th>{c("colPlan")}</th>
                  <th>{c("colCode")}</th>
                  <th>{t("screens.codes.colRef")}</th>
                  <th className="r">{c("colDays")}</th>
                  <th className="r">{c("colAmount")}</th>
                  <th>{t("screens.codes.method")}</th>
                  <th>{c("colStatus")}</th>
                  <th>{c("colStarts")}</th>
                  <th>{c("colEnds")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td><span className="mono">#{inv.id}</span></td>
                    <td><span className="strong nowrap">{inv.company_name ?? "—"}</span></td>
                    <td>{inv.plan ?? "—"}</td>
                    <td>
                      {inv.code ? (
                        <button
                          type="button"
                          onClick={() => setCodeDetail(inv)}
                          title={c("viewCode")}
                          className={`badge ${CODE_TONE[inv.code.status]}`}
                          style={{ border: 0, cursor: "pointer" }}
                        >
                          <span className="mono" dir="ltr">{inv.code.code}</span>
                        </button>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td><span className="mono text-sm" dir="ltr">{inv.code?.payment_ref ?? "—"}</span></td>
                    <td className="r num">{inv.days}</td>
                    <td className="r num strong">{inv.amount !== null ? money(inv.amount) : "—"}</td>
                    <td>{paymentMethodLabel(inv.code?.payment_method, t)}</td>
                    <td>
                      <span className={`badge ${inv.paid ? "success" : "warning"}`}>
                        <span className="dot" />
                        {inv.paid ? c("paid") : c("unpaid")}
                      </span>
                    </td>
                    <td><span className="num nowrap">{new Date(inv.starts_at).toLocaleDateString(latnLocale(locale))}</span></td>
                    <td><span className="num nowrap">{new Date(inv.ends_at).toLocaleDateString(latnLocale(locale))}</span></td>
                    <td className="r">
                      <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => doDownloadPdf(inv.id)} title={c("pdf")}>
                          <FileText /> {c("pdf")}
                        </button>
                        {!inv.paid && (
                          <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--success-fg)" }} onClick={() => setSettling(inv)}>
                            <CheckCircle2 /> {c("settle")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {invoiceMeta && (
          <Pager
            className="border-t border-line p-3"
            page={invoicePage}
            lastPage={invoiceMeta.last_page}
            total={invoiceMeta.total}
            onPage={setInvoicePage}
          />
        )}
      </section>

      {settling && (
        <SettleModal
          invoice={settling}
          onClose={() => setSettling(null)}
          onSettled={async () => {
            await Promise.all([loadInvoices(), refetchSummary()]);
          }}
        />
      )}

      <CodeDetailModal
        code={codeDetail?.code ?? null}
        company={codeDetail?.company_name}
        onClose={() => setCodeDetail(null)}
      />

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

/** Prototype stat tile: icon chip, label and a big tabular value. */
function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "success" | "warning";
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span className={`stat-ico ${tone ?? ""}`}><Icon /></span>
        <span className="truncate">{label}</span>
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone}-fg)` } : undefined}>{value}</div>
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
      toast.error(c("failed"), { description: apiErrorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  }

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
      <div className="stack text-start">
        <div className="field">
          <label htmlFor="pl-name">{c("planName")}</label>
          <input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pl-price">{c("planPrice")}</label>
            <input id="pl-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="input" />
          </div>
          <div className="field">
            <label htmlFor="pl-days">{c("planDuration")}</label>
            <input id="pl-days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className="input" />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>{c("planActive")}</span>
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
      toast.error(c("settleFailed"), { description: apiErrorMessage(e, t, locale) });
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
      <div className="stack text-start">
        <p className="muted text-sm">{c("settleIntro")}</p>
        {payments.length === 0 ? (
          <p className="subtle text-sm">{c("noPayments")}</p>
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
