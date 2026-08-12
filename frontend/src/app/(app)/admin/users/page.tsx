"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Users as UsersIcon, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listUsers, deleteUser, type PlatformUser } from "@/lib/api/admin";

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
                  <tr key={u.id} className="hover:bg-surface-2">
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
                      {u.role !== "super_admin" && (
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
    </div>
  );
}
