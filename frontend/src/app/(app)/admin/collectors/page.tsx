"use client";

import { useState } from "react";
import { latnLocale } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Loader2, Banknote, Trash2, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordInput } from "@/components/ui/password-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import {
  listCollectors,
  createCollector,
  updateCollector,
  deleteCollector,
  type Collector,
} from "@/lib/api/admin";

export default function CollectorsPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.collectors.${k}`);

  const { data: collectorsData, loading, refetch } = useAsync(listCollectors);
  const collectors = collectorsData ?? [];

  const [editing, setEditing] = useState<Collector | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<Collector | null>(null);
  const [busy, setBusy] = useState(false);

  async function doDeleteCollector() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteCollector(confirmDel.id);
      toast.success(c("deleted"));
      await refetch();
    } catch (e) {
      // Backend returns 422 with "collector_has_payments" when they've issued codes.
      const msg = e instanceof Error && e.message === "collector_has_payments" ? c("hasPayments") : undefined;
      toast.error(msg ?? c("failed"), { description: msg ? undefined : e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDel(null);
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

      {/* Collectors + totals derived from the paid codes they issued */}
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
                    <td className="px-4 py-3 text-start text-ink-muted whitespace-nowrap">
                      <span dir="ltr">{col.phone || c("noneShort")}</span>
                    </td>
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

      {editing && (
        <CollectorModal collector={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refetch} />
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
      {type === "password" ? (
        <PasswordInput
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className={mono ? "font-mono text-xs" : ""}
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className={`w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line ${mono ? "font-mono text-xs" : ""}`}
        />
      )}
    </div>
  );
}
