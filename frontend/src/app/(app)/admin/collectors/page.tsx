"use client";

import { useCallback, useEffect, useState } from "react";
import { latnLocale } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Loader2, Banknote, Trash2, Pencil, Download, ReceiptText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import {
  listCollectors,
  createCollector,
  updateCollector,
  deleteCollector,
  listCompanies,
  listCollectorPayments,
  createCollectorPayment,
  deleteCollectorPayment,
  exportCollectorPayments,
  type Collector,
  type CollectorPayment,
  type Company,
  type PaymentFilters,
} from "@/lib/api/admin";

export default function CollectorsPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.collectors.${k}`);

  const { data: collectorsData, loading, refetch } = useAsync(listCollectors);
  const { data: companiesData } = useAsync(listCompanies);
  const collectors = collectorsData ?? [];
  const companies = companiesData ?? [];

  const [editing, setEditing] = useState<Collector | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<Collector | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── Ledger state ──
  const [filters, setFilters] = useState<PaymentFilters>({});
  const [payments, setPayments] = useState<CollectorPayment[]>([]);
  const [sum, setSum] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [confirmDelPay, setConfirmDelPay] = useState<CollectorPayment | null>(null);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const res = await listCollectorPayments(filters);
      setPayments(res.data);
      setSum(res.meta.sum);
    } catch {
      setPayments([]);
    } finally {
      setLedgerLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  async function refetchAll() {
    await Promise.all([refetch(), loadLedger()]);
  }

  async function doDeleteCollector() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteCollector(confirmDel.id);
      toast.success(c("deleted"));
      await refetch();
    } catch (e) {
      // Backend returns 422 with "collector_has_payments" when a ledger exists.
      const msg = e instanceof Error && e.message === "collector_has_payments" ? c("hasPayments") : undefined;
      toast.error(msg ?? c("failed"), { description: msg ? undefined : e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDel(null);
    }
  }

  async function doDeletePayment() {
    if (!confirmDelPay) return;
    setBusy(true);
    try {
      await deleteCollectorPayment(confirmDelPay.id);
      toast.success(c("deleted"));
      await refetchAll();
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDelPay(null);
    }
  }

  async function doExport() {
    try {
      const blob = await exportCollectorPayments(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "collector-payments.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(c("exportFailed"), { description: e instanceof Error ? e.message : undefined });
    }
  }

  const money = (n: number) => new Intl.NumberFormat(latnLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="collectors"
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> {c("add")}
          </Button>
        }
      />

      {/* Collectors + per-collector totals */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : collectors.length === 0 ? (
          <EmptyState icon={Banknote} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colName")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colPhone")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colTotal")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCount")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colLast")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {collectors.map((col) => (
                  <tr key={col.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3 font-medium text-ink">{col.name}</td>
                    <td className="px-4 py-3 text-ink-muted" dir="ltr">{col.phone || c("noneShort")}</td>
                    <td className="px-4 py-3 font-semibold text-ink">{money(col.total_collected)}</td>
                    <td className="px-4 py-3 text-ink-muted">{col.payments_count}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {col.last_paid_on ? new Date(col.last_paid_on).toLocaleDateString(latnLocale(locale)) : c("noneShort")}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(col)} className="rounded p-1.5 text-ink-subtle hover:bg-surface-2 hover:text-ink" title={c("edit")}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setConfirmDel(col)} className="rounded p-1.5 text-ink-subtle hover:bg-danger-bg hover:text-danger-fg" title={c("delete")}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Payment ledger */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <h3 className="font-semibold text-ink">{c("ledgerTitle")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-44"
              value={filters.collector_id ? String(filters.collector_id) : ""}
              onChange={(v) => setFilters((f) => ({ ...f, collector_id: v ? Number(v) : undefined }))}
              options={[{ value: "", label: c("filterCollector") }, ...collectors.map((col) => ({ value: String(col.id), label: col.name }))]}
            />
            <Select
              className="w-44"
              value={filters.tenant_id ? String(filters.tenant_id) : ""}
              onChange={(v) => setFilters((f) => ({ ...f, tenant_id: v ? Number(v) : undefined }))}
              options={[{ value: "", label: c("filterCompany") }, ...companies.map((co) => ({ value: String(co.id), label: co.name }))]}
            />
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
              className="rounded-lg border border-line-strong px-2 py-1.5 text-sm outline-none focus:border-ink"
              title={c("from")}
            />
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
              className="rounded-lg border border-line-strong px-2 py-1.5 text-sm outline-none focus:border-ink"
              title={c("to")}
            />
            {(filters.collector_id || filters.tenant_id || filters.from || filters.to) && (
              <button onClick={() => setFilters({})} className="text-xs text-ink-muted hover:text-ink">
                {c("clearFilters")}
              </button>
            )}
            <Button variant="secondary" onClick={doExport} disabled={payments.length === 0}>
              <Download className="h-4 w-4" /> {c("exportExcel")}
            </Button>
            <Button onClick={() => setRecording(true)} disabled={collectors.length === 0 || companies.length === 0}>
              <Plus className="h-4 w-4" /> {c("recordPayment")}
            </Button>
          </div>
        </div>

        {ledgerLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <EmptyState icon={ReceiptText} title={c("ledgerEmpty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colDate")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCompany")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCollector")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colAmount")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colNote")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3 text-ink-muted">{new Date(p.paid_on).toLocaleDateString(latnLocale(locale))}</td>
                    <td className="px-4 py-3 font-medium text-ink">{p.company_name ?? c("noneShort")}</td>
                    <td className="px-4 py-3 text-ink-muted">{p.collector_name ?? c("noneShort")}</td>
                    <td className="px-4 py-3 font-semibold text-ink">{money(p.amount)}</td>
                    <td className="px-4 py-3 text-ink-muted">{p.note || c("noneShort")}</td>
                    <td className="px-4 py-3 text-end">
                      <button onClick={() => setConfirmDelPay(p)} className="rounded p-1.5 text-ink-subtle hover:bg-danger-bg hover:text-danger-fg" title={c("delete")}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-surface-2">
                <tr>
                  <td className="px-4 py-3 font-semibold text-ink-muted" colSpan={3}>{c("ledgerSum")}</td>
                  <td className="px-4 py-3 font-bold text-ink">{money(sum)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <CollectorModal collector={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refetch} />
      )}

      {recording && (
        <PaymentModal collectors={collectors} companies={companies} onClose={() => setRecording(false)} onSaved={refetchAll} />
      )}

      <ConfirmModal
        open={confirmDel !== null}
        danger
        title={c("delete")}
        message={c("deleteConfirm").replace("{name}", confirmDel?.name ?? "")}
        confirmLabel={c("delete")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={doDeleteCollector}
        onCancel={() => setConfirmDel(null)}
      />

      <ConfirmModal
        open={confirmDelPay !== null}
        danger
        title={c("delete")}
        message={c("deletePaymentConfirm")}
        confirmLabel={c("delete")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={doDeletePayment}
        onCancel={() => setConfirmDelPay(null)}
      />
    </div>
  );
}

function CollectorModal({ collector, onClose, onSaved }: { collector: Collector | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.collectors.${k}`);
  const [name, setName] = useState(collector?.name ?? "");
  const [phone, setPhone] = useState(collector?.phone ?? "");
  const [address, setAddress] = useState(collector?.address ?? "");
  const [email, setEmail] = useState(collector?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        email: email.trim() || undefined,
        password: password.trim() || undefined,
      };
      if (collector) await updateCollector(collector.id, input);
      else await createCollector(input);
      toast.success(c("saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={collector ? c("edit") : c("add")}
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
        <Field label={c("fieldName")} value={name} onChange={setName} />
        <Field label={c("fieldPhone")} value={phone} onChange={setPhone} mono />
        <Field label={c("fieldAddress")} value={address} onChange={setAddress} />
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">{c("loginSection")}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={c("fieldEmail")} value={email} onChange={setEmail} mono />
            <Field label={c("fieldPassword")} value={password} onChange={setPassword} type="password" placeholder={collector?.has_login ? "••••••" : ""} />
          </div>
          <p className="mt-1 text-xs text-ink-subtle">{c("loginHint")}</p>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({
  collectors,
  companies,
  onClose,
  onSaved,
}: {
  collectors: Collector[];
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.collectors.${k}`);
  const [collectorId, setCollectorId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = Boolean(collectorId && tenantId && Number(amount) > 0 && paidOn);

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      await createCollectorPayment({
        collector_id: Number(collectorId),
        tenant_id: Number(tenantId),
        amount: Number(amount),
        paid_on: paidOn,
        note: note.trim() || undefined,
      });
      toast.success(c("paymentSaved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const selectClass = "w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line";

  return (
    <Modal
      open
      onClose={onClose}
      title={c("recordPayment")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{c("cancel")}</Button>
          <Button onClick={save} disabled={busy || !valid}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{c("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-start">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">{c("fieldCompany")}</label>
          <Select
            value={tenantId}
            onChange={setTenantId}
            placeholder={c("selectCompany")}
            options={companies.map((co) => ({ value: String(co.id), label: co.name }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">{c("fieldCollector")}</label>
          <Select
            value={collectorId}
            onChange={setCollectorId}
            placeholder={c("selectCollector")}
            options={collectors.map((col) => ({ value: String(col.id), label: col.name }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={c("fieldAmount")} type="number" value={amount} onChange={setAmount} />
          <Field label={c("fieldDate")} type="date" value={paidOn} onChange={setPaidOn} />
        </div>
        <Field label={c("fieldNote")} value={note} onChange={setNote} />
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  mono = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className={`w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}
