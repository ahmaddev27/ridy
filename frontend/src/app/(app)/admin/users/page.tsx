"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Users as UsersIcon, Trash2, Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listUsers, deleteUser, type PlatformUser } from "@/lib/api/admin";
import { BroadcastModal } from "./broadcast-modal";
import { Pager } from "@/components/ui/pager";
import { apiErrorMessage } from "@/lib/api/error-message";

const PAGE_SIZE = 50;

const ROLE_TONE: Record<string, string> = {
  super_admin: "accent",
  reseller: "info",
  fleet_manager: "info",
  owner: "info",
  driver: "success",
  viewer: "",
};

const STATUS_TONE: Record<string, string> = {
  active: "success",
  disabled: "",
  banned: "danger",
  expired: "warning",
  inactive: "warning",
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

  // Typing stays responsive: filtering runs on a deferred copy of the query.
  const deferredQ = useDeferredValue(q);
  const filtered = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    return users.filter((u) => {
      if (roles.size > 0 && !roles.has(u.role)) return false;
      if (!s) return true;
      return [u.name, u.email, u.phone, u.company].some((v) => (v ?? "").toLowerCase().includes(s));
    });
  }, [users, deferredQ, roles]);

  // Render one page at a time — the directory grows with every fleet and driver.
  const [page, setPage] = useState(1);
  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [deferredQ, roles]);
  const pageRows = useMemo(
    () => filtered.slice((Math.min(page, lastPage) - 1) * PAGE_SIZE, Math.min(page, lastPage) * PAGE_SIZE),
    [filtered, page, lastPage],
  );

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // "Select all" covers the visible page; selections on other pages are kept.
  const allVisibleSelected = pageRows.length > 0 && pageRows.every((u) => selected.has(rowKey(u)));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) pageRows.forEach((u) => next.delete(rowKey(u)));
      else pageRows.forEach((u) => next.add(rowKey(u)));
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
      toast.error(c("deleteFailed"), { description: apiErrorMessage(e, t) });
    } finally {
      setBusy(false);
      setConfirmDel(null);
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader tkey="users" />

      <div className="toolbar">
        <div className="min-w-60 flex-1">
          <SearchInput value={q} onChange={setQ} placeholder={c("searchPlaceholder")} className="max-w-[420px]" />
        </div>
        <button type="button" onClick={() => setBroadcastOpen(true)} className="btn btn-primary">
          <Megaphone />
          {c("broadcast.send")}
          {selected.size > 0 && <span className="num rounded-full bg-white/25 px-1.5 text-xs">{selected.size}</span>}
        </button>
      </div>

      {/* Multi-select role filter */}
      <div className="row-wrap" role="group">
        {availableRoles.map((r) => (
          <button key={r} type="button" onClick={() => toggleRole(r)} aria-pressed={roles.has(r)} className={"chip" + (roles.has(r) ? " on" : "")}>
            {c(`role_${r}`)}
          </button>
        ))}
      </div>

      <Card className="table-card">
        {loading ? (
          <div className="stack-sm p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel h-12" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">
              <UsersIcon className="h-6 w-6" />
            </div>
            <h3>{c("emptyTitle")}</h3>
            <p>{c("emptyDesc")}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>
                    <label className="check">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label={t("common.selectAll")} />
                    </label>
                  </th>
                  <th>{c("colUser")}</th>
                  <th>{c("colPhone")}</th>
                  <th>{c("colRole")}</th>
                  <th>{c("colCompany")}</th>
                  <th>{c("colStatus")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((u) => (
                  <tr key={rowKey(u)}>
                    <td>
                      <label className="check">
                        <input type="checkbox" checked={selected.has(rowKey(u))} onChange={() => toggleSelected(rowKey(u))} aria-label={u.name} />
                      </label>
                    </td>
                    <td>
                      <div className="strong">{u.name}</div>
                      <div className="subtle text-xs">{u.email}</div>
                    </td>
                    <td>{u.phone ? <bdi dir="ltr" className="num nowrap">{u.phone}</bdi> : <span className="subtle">{c("none")}</span>}</td>
                    <td>
                      <span className={`badge square ${ROLE_TONE[u.role] ?? ""}`}>{c(`role_${u.role}`)}</span>
                    </td>
                    <td>{u.company || <span className="subtle">{c("none")}</span>}</td>
                    <td>
                      <span className={`badge ${STATUS_TONE[u.status] ?? ""}`}>
                        <span className="dot" />
                        {c(`st_${u.status}`)}
                      </span>
                    </td>
                    <td>
                      {u.kind === "user" && u.role !== "super_admin" && (
                        <div className="row-actions">
                          <button type="button" onClick={() => setConfirmDel(u)} className="btn btn-ghost btn-icon btn-sm" title={c("delete")} aria-label={c("delete")}>
                            <Trash2 />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lastPage > 1 && (
          <div className="tbl-foot">
            <Pager className="w-full" page={Math.min(page, lastPage)} lastPage={lastPage} total={filtered.length} onPage={setPage} />
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
