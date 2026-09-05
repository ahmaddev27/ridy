"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Plug, Trash2, Pencil, AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listProxies, createProxy, updateProxy, deleteProxy, renewProxy, type Proxy } from "@/lib/api/admin";

export default function ProxiesPage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.proxies.${k}`);
  const { data, loading, refetch } = useAsync(listProxies, { refetchInterval: 15000 });
  const proxies = data ?? [];

  const [editing, setEditing] = useState<Proxy | "new" | null>(null);
  const [renewing, setRenewing] = useState<Proxy | null>(null);
  const [confirmDel, setConfirmDel] = useState<Proxy | null>(null);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteProxy(confirmDel.id);
      toast.success(c("deleted"));
      await refetch();
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDel(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="proxies"
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> {c("add")}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : proxies.length === 0 ? (
          <EmptyState icon={Plug} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colLabel")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colUrl")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colUsage")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCost")}</th>
                  <th className="px-4 py-3 font-semibold">{c("fieldNotes")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {proxies.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{p.label}</div>
                      {p.expires_at && (
                        <div
                          className={
                            "mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold " +
                            (p.expiring ? "bg-danger-bg text-danger-fg" : "bg-surface-2 text-ink-muted")
                          }
                        >
                          {p.days_left !== null && p.days_left < 0
                            ? c("expired")
                            : c("expiresIn").replace("{n}", String(p.days_left ?? 0))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                      <bdi dir="ltr">{p.url_masked}</bdi>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className={`h-full rounded-full ${p.near_full ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${Math.min(100, (p.used / Math.max(1, p.capacity)) * 100)}%` }}
                          />
                        </div>
                        <bdi dir="ltr" className="whitespace-nowrap text-xs text-ink-muted">{p.used} / {p.capacity}</bdi>
                        {p.near_full && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-warning-fg">
                            <AlertTriangle className="h-3 w-3" /> {c("nearFull")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {p.price != null ? (
                        <div className="font-medium tabular-nums text-ink">€{p.price.toFixed(2)}</div>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                      {p.source && <div className="text-xs text-ink-subtle">{p.source}</div>}
                      {p.renewals.length > 0 && (
                        <div className="mt-0.5 text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                          {c("totalPaid")}: €{p.total_paid.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-ink-muted" title={p.notes ?? ""}>{p.notes || "—"}</td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setRenewing(p)} className="rounded p-1.5 text-ink-subtle hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950" title={c("renew")}>
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <button onClick={() => setEditing(p)} className="rounded p-1.5 text-ink-subtle hover:bg-surface-2 hover:text-ink" title={c("edit")}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setConfirmDel(p)} className="rounded p-1.5 text-ink-subtle hover:bg-danger-bg hover:text-danger-fg" title={c("delete")}>
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
        <ProxyModal proxy={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refetch} />
      )}

      {renewing && <RenewProxyModal proxy={renewing} onClose={() => setRenewing(null)} onSaved={refetch} />}

      <ConfirmModal
        open={confirmDel !== null}
        danger
        title={c("delete")}
        message={c("deleteConfirm").replace("{label}", confirmDel?.label ?? "")}
        confirmLabel={c("delete")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

function ProxyModal({ proxy, onClose, onSaved }: { proxy: Proxy | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.proxies.${k}`);
  const [label, setLabel] = useState(proxy?.label ?? "");
  const [url, setUrl] = useState("");
  const [capacity, setCapacity] = useState(String(proxy?.capacity ?? 10));
  const [price, setPrice] = useState(proxy?.price != null ? String(proxy.price) : "");
  const [source, setSource] = useState(proxy?.source ?? "");
  const [notes, setNotes] = useState(proxy?.notes ?? "");
  const [startsAt, setStartsAt] = useState(proxy?.starts_at ?? "");
  const [expiresAt, setExpiresAt] = useState(proxy?.expires_at ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!label.trim() || (!proxy && !url.trim())) return;
    setBusy(true);
    try {
      const input = {
        label: label.trim(),
        capacity: Number(capacity) || 1,
        price: price.trim() ? Number(price) : undefined,
        source: source.trim() || undefined,
        notes: notes.trim() || undefined,
        starts_at: startsAt || undefined,
        expires_at: expiresAt || undefined,
        ...(url.trim() ? { url: url.trim() } : {}),
      };
      if (proxy) await updateProxy(proxy.id, input);
      else await createProxy(input);
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
      title={proxy ? c("edit") : c("add")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{c("cancel")}</Button>
          <Button onClick={save} disabled={busy || !label.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{c("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-start">
        <Field label={c("fieldLabel")} value={label} onChange={setLabel} />
        <Field
          label={c("fieldUrl")}
          value={url}
          onChange={setUrl}
          mono
          placeholder={proxy ? "••••••  (leave blank to keep)" : "http://user:pass@host:port"}
        />
        <Field label={c("fieldCapacity")} type="number" value={capacity} onChange={setCapacity} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={c("fieldPrice")} type="number" value={price} onChange={setPrice} placeholder="0.00" />
          <Field label={c("fieldSource")} value={source} onChange={setSource} placeholder={c("sourcePlaceholder")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={c("fieldStart")} type="date" value={startsAt} onChange={setStartsAt} />
          <Field label={c("fieldExpires")} type="date" value={expiresAt} onChange={setExpiresAt} />
        </div>
        <Field label={c("fieldNotes")} value={notes} onChange={setNotes} />
      </div>
    </Modal>
  );
}

function RenewProxyModal({ proxy, onClose, onSaved }: { proxy: Proxy; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.proxies.${k}`);
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(proxy.price != null ? String(proxy.price) : "");
  const [startsAt, setStartsAt] = useState(proxy.ends_at ?? proxy.expires_at ?? today);
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const canSave = amount.trim() !== "" && startsAt !== "" && endsAt !== "" && endsAt >= startsAt;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      await renewProxy(proxy.id, { amount: Number(amount), starts_at: startsAt, ends_at: endsAt, note: note.trim() || undefined });
      toast.success(c("renewed"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  // History = every renewal (newest first) plus the base (first) purchase.
  const history = [
    ...proxy.renewals,
    { id: 0, amount: proxy.price ?? 0, starts_at: proxy.starts_at, ends_at: proxy.expires_at, note: c("initialPurchase") },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={`${c("renewTitle")} — ${proxy.label}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{c("cancel")}</Button>
          <Button onClick={save} disabled={busy || !canSave}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{c("renew")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-start">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span className="text-ink-subtle">{c("totalPaid")}</span>
            <span className="font-bold tabular-nums text-ink">€{proxy.total_paid.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span className="text-ink-subtle">{c("currentEnd")}</span>
            <bdi dir="ltr" className="font-medium text-ink">{proxy.ends_at ?? "—"}</bdi>
          </div>
        </div>

        <Field label={c("fieldAmount")} type="number" value={amount} onChange={setAmount} placeholder="0.00" />
        <div className="grid grid-cols-2 gap-3">
          <Field label={c("fieldStart")} type="date" value={startsAt} onChange={setStartsAt} />
          <Field label={c("fieldEnd")} type="date" value={endsAt} onChange={setEndsAt} />
        </div>
        <Field label={c("fieldNotes")} value={note} onChange={setNote} />

        <div>
          <div className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">{c("history")}</div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="shrink-0 font-medium tabular-nums text-ink">€{h.amount.toFixed(2)}</span>
                <bdi dir="ltr" className="text-xs text-ink-muted">
                  {h.starts_at ?? "—"} → {h.ends_at ?? "—"}
                </bdi>
                <span className="min-w-0 flex-1 truncate text-end text-xs text-ink-subtle">{h.note}</span>
              </li>
            ))}
          </ul>
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
