"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Plug, Trash2, Pencil, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listProxies, createProxy, updateProxy, deleteProxy, type Proxy } from "@/lib/api/admin";

export default function ProxiesPage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.proxies.${k}`);
  const { data, loading, refetch } = useAsync(listProxies, { refetchInterval: 15000 });
  const proxies = data ?? [];

  const [editing, setEditing] = useState<Proxy | "new" | null>(null);
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
              <div key={i} className="h-14 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : proxies.length === 0 ? (
          <EmptyState icon={Plug} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colLabel")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colUrl")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colUsage")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {proxies.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{p.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      <bdi dir="ltr">{p.url_masked}</bdi>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${p.near_full ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${Math.min(100, (p.used / Math.max(1, p.capacity)) * 100)}%` }}
                          />
                        </div>
                        <bdi dir="ltr" className="whitespace-nowrap text-xs text-slate-600">{p.used} / {p.capacity}</bdi>
                        {p.near_full && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-amber-600">
                            <AlertTriangle className="h-3 w-3" /> {c("nearFull")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title={c("edit")}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setConfirmDel(p)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title={c("delete")}>
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
  const [notes, setNotes] = useState(proxy?.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!label.trim() || (!proxy && !url.trim())) return;
    setBusy(true);
    try {
      const input = { label: label.trim(), capacity: Number(capacity) || 1, notes: notes.trim() || undefined, ...(url.trim() ? { url: url.trim() } : {}) };
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
        <Field label={c("fieldNotes")} value={notes} onChange={setNotes} />
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
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200 ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}
