"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Plug, Trash2, Pencil, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/utils";
import { useAsync } from "@/hooks/use-async";
import { listProxies, createProxy, updateProxy, deleteProxy, renewProxy, type Proxy } from "@/lib/api/admin";

export default function ProxiesPage() {
  const { t, locale } = useI18n();
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
    <div className="stack-lg">
      <header className="ph">
        <div>
          <h1>{t("pages.proxies.title")}</h1>
          <p>{t("pages.proxies.subtitle")}</p>
        </div>
        <div className="ph-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> {c("add")}
          </button>
        </div>
      </header>

      <section className="card table-card">
        {loading ? (
          <div className="stack" style={{ padding: 16 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel" style={{ height: 52 }} />
            ))}
          </div>
        ) : proxies.length === 0 ? (
          <div className="empty">
            <div className="empty-ico"><Plug className="h-5 w-5" /></div>
            <h3>{c("emptyTitle")}</h3>
            <p>{c("emptyDesc")}</p>
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> {c("add")}
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{c("colLabel")}</th>
                  <th>{c("colUrl")}</th>
                  <th>{c("colUsage")}</th>
                  <th>{c("colCost")}</th>
                  <th>{c("fieldNotes")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {proxies.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="stack-sm" style={{ gap: 4 }}>
                        <span className="strong mono">{p.label}</span>
                        {p.expires_at && (
                          <span>
                            <span className={"badge " + (p.expiring ? "danger" : "")}>
                              {p.days_left !== null && p.days_left < 0
                                ? c("expired")
                                : c("expiresIn").replace("{n}", String(p.days_left ?? 0))}
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono subtle truncate" style={{ display: "block", maxWidth: 260 }}>
                        {p.url_masked}
                      </bdi>
                    </td>
                    <td>
                      <div style={{ minWidth: 150 }}>
                        <div className="row" style={{ gap: 10 }}>
                          <div className={"meter" + (p.near_full ? " warning" : "")} style={{ width: 96 }}>
                            <i style={{ width: `${Math.min(100, (p.used / Math.max(1, p.capacity)) * 100)}%` }} />
                          </div>
                          <bdi dir="ltr" className="num text-sm">{p.used} / {p.capacity}</bdi>
                        </div>
                        {p.near_full && (
                          <div className="warn text-xs row" style={{ gap: 4, marginTop: 4 }}>
                            <AlertTriangle className="h-3.5 w-3.5" /> {c("nearFull")}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      {p.price != null ? (
                        <div className="num strong">{formatMoney(p.price, locale)}</div>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                      {p.source && <div className="subtle text-xs">{p.source}</div>}
                      {p.renewals.length > 0 && (
                        <div className="pos text-xs num">
                          {c("totalPaid")}: {formatMoney(p.total_paid, locale)}
                        </div>
                      )}
                    </td>
                    <td>
                      {p.notes ? (
                        <span className="muted text-sm truncate" style={{ display: "block", maxWidth: 220 }} title={p.notes}>
                          {p.notes}
                        </span>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="icon-btn pos" onClick={() => setRenewing(p)} title={c("renew")} aria-label={c("renew")}>
                          <RefreshCw />
                        </button>
                        <button type="button" className="icon-btn" onClick={() => setEditing(p)} title={c("edit")} aria-label={c("edit")}>
                          <Pencil />
                        </button>
                        <button type="button" className="icon-btn neg" onClick={() => setConfirmDel(p)} title={c("delete")} aria-label={c("delete")}>
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
      </section>

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
  const { t, locale } = useI18n();
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
      <div className="stack text-start">
        <Field label={c("fieldLabel")} value={label} onChange={setLabel} />
        <Field
          label={c("fieldUrl")}
          value={url}
          onChange={setUrl}
          mono
          placeholder={proxy ? "••••••  (leave blank to keep)" : "http://user:pass@host:port"}
        />
        <Field label={c("fieldCapacity")} type="number" value={capacity} onChange={setCapacity} />
        <div className="form-grid">
          <Field label={c("fieldPrice")} type="number" value={price} onChange={setPrice} placeholder="0.00" />
          <Field label={c("fieldSource")} value={source} onChange={setSource} placeholder={c("sourcePlaceholder")} />
        </div>
        <div className="form-grid">
          <Field label={c("fieldStart")} type="date" value={startsAt} onChange={setStartsAt} />
          <Field label={c("fieldExpires")} type="date" value={expiresAt} onChange={setExpiresAt} />
        </div>
        <Field label={c("fieldNotes")} value={notes} onChange={setNotes} />
      </div>
    </Modal>
  );
}

function RenewProxyModal({ proxy, onClose, onSaved }: { proxy: Proxy; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
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
      <div className="stack text-start">
        <div className="form-grid">
          <div className="card inset" style={{ padding: 12 }}>
            <div className="subtle text-xs">{c("totalPaid")}</div>
            <div className="strong num text-md">{formatMoney(proxy.total_paid, locale)}</div>
          </div>
          <div className="card inset" style={{ padding: 12 }}>
            <div className="subtle text-xs">{c("currentEnd")}</div>
            <bdi dir="ltr" className="strong num text-md">{proxy.ends_at ?? "—"}</bdi>
          </div>
        </div>

        <Field label={c("fieldAmount")} type="number" value={amount} onChange={setAmount} placeholder="0.00" />
        <div className="form-grid">
          <Field label={c("fieldStart")} type="date" value={startsAt} onChange={setStartsAt} />
          <Field label={c("fieldEnd")} type="date" value={endsAt} onChange={setEndsAt} />
        </div>
        <Field label={c("fieldNotes")} value={note} onChange={setNote} />

        <div>
          <h3 className="section-title" style={{ marginBottom: 8 }}>{c("history")}</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="shrink-0 font-medium tabular-nums text-ink">{formatMoney(h.amount, locale)}</span>
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
    <div className="field">
      <label>{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className={`input ${mono ? "mono" : ""}`}
      />
    </div>
  );
}
