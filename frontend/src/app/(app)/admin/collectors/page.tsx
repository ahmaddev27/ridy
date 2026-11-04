"use client";

import { useState } from "react";
import { latnLocale } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Loader2, Banknote, Trash2, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordInput } from "@/components/ui/password-input";
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
import { apiErrorMessage } from "@/lib/api/error-message";

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
    <div className="stack-lg">
      <PageHeader
        tkey="collectors"
        action={
          <button type="button" onClick={() => setEditing("new")} className="btn btn-primary">
            <Plus /> {c("add")}
          </button>
        }
      />

      {/* Collectors + totals derived from the paid codes they issued */}
      <Card className="table-card">
        {loading ? (
          <div className="stack-sm p-4">
            {[0, 1].map((i) => (
              <div key={i} className="skel h-14" />
            ))}
          </div>
        ) : collectors.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">
              <Banknote className="h-6 w-6" />
            </div>
            <h3>{c("emptyTitle")}</h3>
            <p>{c("emptyDesc")}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{c("colName")}</th>
                  <th>{c("colPhone")}</th>
                  <th className="r">{c("colTotal")}</th>
                  <th className="r">{c("colCount")}</th>
                  <th>{c("colLast")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {collectors.map((col) => (
                  <tr key={col.id}>
                    <td className="strong">{col.name}</td>
                    <td className="nowrap">
                      {col.phone ? <bdi dir="ltr" className="num">{col.phone}</bdi> : <span className="subtle">{c("noneShort")}</span>}
                    </td>
                    <td className="r strong num">{money(col.total_collected)}</td>
                    <td className="r num">{col.payments_count}</td>
                    <td className="num">
                      {col.last_paid_on ? new Date(col.last_paid_on).toLocaleDateString(latnLocale(locale)) : <span className="subtle">{c("noneShort")}</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" onClick={() => setEditing(col)} className="btn btn-ghost btn-icon btn-sm" title={c("edit")} aria-label={c("edit")}>
                          <Pencil />
                        </button>
                        <button type="button" onClick={() => setConfirmDel(col)} className="btn btn-ghost btn-icon btn-sm" title={c("delete")} aria-label={c("delete")}>
                          <Trash2 />
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
      toast.error(c("failed"), { description: apiErrorMessage(e, t) });
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
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{c("cancel")}</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="animate-spin" />}{c("save")}
          </button>
        </div>
      }
    >
      <div className="stack text-start">
        <Field label={c("fieldName")} value={name} onChange={setName} />
        <Field label={c("fieldPhone")} value={phone} onChange={setPhone} mono />
        <Field label={c("fieldAddress")} value={address} onChange={setAddress} />
        <hr className="sep" />
        <div className="stack-sm">
          <p className="strong text-sm">{c("loginSection")}</p>
          <div className="grid g-2">
            <Field label={c("fieldEmail")} value={email} onChange={setEmail} mono />
            <Field label={c("fieldPassword")} value={password} onChange={setPassword} type="password" placeholder={collector?.has_login ? "••••••" : ""} />
          </div>
          <p className="subtle text-sm">{c("loginHint")}</p>
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
    <div className="field">
      <label>{label}</label>
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
          className={`input ${mono ? "mono" : ""}`}
          dir={mono ? "ltr" : undefined}
        />
      )}
    </div>
  );
}
