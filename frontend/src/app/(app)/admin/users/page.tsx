"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Users as UsersIcon, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listUsers, deleteUser, type PlatformUser } from "@/lib/api/admin";

const ROLE_TONE: Record<string, string> = {
  super_admin: "bg-slate-900 text-white",
  reseller: "bg-indigo-50 text-indigo-700",
  fleet_manager: "bg-sky-50 text-sky-700",
  owner: "bg-sky-50 text-sky-700",
  driver: "bg-emerald-50 text-emerald-700",
  viewer: "bg-slate-100 text-slate-600",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  disabled: "bg-slate-100 text-slate-600",
  banned: "bg-rose-50 text-rose-700",
  expired: "bg-amber-50 text-amber-700",
  inactive: "bg-amber-50 text-amber-700",
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
        <div className="relative max-w-sm flex-1">
          <Search className="absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ltr:left-3 rtl:right-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={c("searchPlaceholder")}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200 ltr:pl-9 ltr:pr-3 rtl:pr-9 rtl:pl-3"
          />
        </div>
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
                  (on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
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
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={UsersIcon} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colUser")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colPhone")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colRole")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCompany")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{u.name}</div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500"><bdi dir="ltr">{u.phone || c("none")}</bdi></td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_TONE[u.role] ?? "bg-slate-100 text-slate-600"}`}>
                        {c(`role_${u.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.company || c("none")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[u.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {c(`st_${u.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      {u.role !== "super_admin" && (
                        <button
                          onClick={() => setConfirmDel(u)}
                          className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
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
