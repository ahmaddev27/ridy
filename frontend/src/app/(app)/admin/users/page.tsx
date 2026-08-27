"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Users as UsersIcon, Trash2, Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listUsers, deleteUser, type PlatformUser } from "@/lib/api/admin";
import { BroadcastModal } from "./broadcast-modal";

const ROLE_TONE: Record<string, string> = {
  super_admin: "bg-primary text-primary-ink",
  reseller: "bg-indigo-50 text-indigo-700",
  fleet_manager: "bg-info-bg text-sky-700",
  owner: "bg-info-bg text-sky-700",
  driver: "bg-success-bg text-success-fg",
  viewer: "bg-surface-2 text-ink-muted",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-success-bg text-success-fg",
  disabled: "bg-surface-2 text-ink-muted",
  banned: "bg-danger-bg text-danger-fg",
  expired: "bg-warning-bg text-warning-fg",
  inactive: "bg-warning-bg text-warning-fg",
};

export default function UsersPage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.users.${k}`);
  const { data, loading, refetch } = useAsync(listUsers);
  const users = data ?? [];
  const [q, setQ] = useState("");
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<PlatformUser | null>(null);
  const [busy, setBusy] = useState(false);
  // Keyed by kind+id — a user and a driver can share the same numeric id.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const rowKey = (u: PlatformUser) => `${u.kind}:${u.id}`;

  // Distinct roles present, for the multi-select filter chips.
  const availableRoles = useMemo(() => Array.from(new Set(users.map((u) => u.role))), [users]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) => {
      if (roles.size > 0 && !roles.has(u.role)) return false;
      if (!s) return true;
      return [u.name, u.email, u.phone, u.company].some((v) => (v ?? "").toLowerCase().includes(s));
    });
  }, [users, q, roles]);

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((u) => selected.has(rowKey(u)));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((u) => next.delete(rowKey(u)));
      else filtered.forEach((u) => next.add(rowKey(u)));
      return next;
    });
  }

  function toggleRole(r: string) {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  async function doDelete() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteUser(confirmDel.id);
      toast.success(c("deleted"));
      await refetch();
    } catch (e) {
      toast.error(c("deleteFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDel(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader tkey="users" />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder={c("searchPlaceholder")} className="flex-1" />
        <button
          onClick={() => setBroadcastOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-ink"
        >
          <Megaphone className="h-4 w-4" />
          {c("broadcast.send")}
          {selected.size > 0 && <span className="rounded-full bg-primary-ink/20 px-1.5 text-xs">{selected.size}</span>}
        </button>
        {/* Multi-select role filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          {availableRoles.map((r) => {
            const on = roles.has(r);
            return (
              <button
                key={r}
                onClick={() => toggleRole(r)}
                className={
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors " +
                  (on ? "bg-primary text-primary-ink" : "bg-surface-2 text-ink-muted hover:bg-surface-2")
                }
              >
                {c(`role_${r}`)}
              </button>
            );
          })}
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={UsersIcon} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="select all"
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">{c("colUser")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colPhone")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colRole")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCompany")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((u) => (
                  <tr key={rowKey(u)} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(rowKey(u))}
                        onChange={() => toggleSelected(rowKey(u))}
                        aria-label={`select ${u.name}`}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{u.name}</div>
                      <div className="text-xs text-ink-subtle">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted"><bdi dir="ltr">{u.phone || c("none")}</bdi></td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_TONE[u.role] ?? "bg-surface-2 text-ink-muted"}`}>
                        {c(`role_${u.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{u.company || c("none")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[u.status] ?? "bg-surface-2 text-ink-muted"}`}>
                        {c(`st_${u.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      {u.kind === "user" && u.role !== "super_admin" && (
                        <button
                          onClick={() => setConfirmDel(u)}
                          className="rounded p-1.5 text-ink-subtle hover:bg-danger-bg hover:text-danger-fg"
                          title={c("delete")}
                        >
                          <Trash2 className="h-4 w-4" />
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

      <ConfirmModal
        open={confirmDel !== null}
        danger
        title={c("delete")}
        message={c("deleteConfirm").replace("{name}", confirmDel?.name ?? "")}
        confirmLabel={c("delete")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(null)}
      />

      <BroadcastModal
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        selected={users.filter((u) => selected.has(rowKey(u)))}
        t={(k) => c(`broadcast.${k}`)}
        roleLabel={(r) => c(`role_${r}`)}
      />
    </div>
  );
}
