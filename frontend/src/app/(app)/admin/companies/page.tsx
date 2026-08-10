"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Building2, Search, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listCompanies, createCompany, disableCompany, type Company } from "@/lib/api/admin";
import { CompanyDetailModal } from "./company-detail-modal";

const sessionTone: Record<string, Status> = {
  active: "connected",
  needs_relink: "expiring",
  expired: "error",
};

export default function CompaniesPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const { data, loading, error, refetch } = useAsync(listCompanies, { refetchInterval: 15000 });
  const all = data ?? [];

  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [confirmDel, setConfirmDel] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  // Client-side search + pagination (the company list is small).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((co) =>
      [co.name, co.country, co.uber_org_uuid].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [all, search]);

  const lastPage = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageClamped = Math.min(page, lastPage);
  const companies = filtered.slice((pageClamped - 1) * perPage, pageClamped * perPage);

  async function doDelete() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await disableCompany(confirmDel.id);
      toast.success(c("deletedToast"));
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
      <PageHeader
        tkey="companies"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {c("newCompany")}
          </Button>
        }
      />

      {/* Toolbar: search + rows-per-page */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={c("searchPlaceholder")}
            className="w-full rounded-lg border border-slate-300 py-2 ps-9 pe-3 text-sm outline-none focus:border-black focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-600">{c("loadError")} — {error}</div>
        ) : companies.length === 0 ? (
          <EmptyState icon={Building2} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colName")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colSession")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colDrivers")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colOffers")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colProxy")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {companies.map((co) => (
                  <tr
                    key={co.id}
                    onClick={() => setSelected(co.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{co.name}</div>
                      <div className="text-xs text-slate-400">{co.country ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={co.status === "active" ? "connected" : "neutral"} dot>
                        {co.status === "active" ? c("statusActive") : c("statusDisabled")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {co.session_status ? (
                        <Badge status={sessionTone[co.session_status] ?? "gap"} dot>
                          {c(`session_${co.session_status}`)}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">{c("noSession")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{co.driver_count.toLocaleString(locale)}</td>
                    <td className="px-4 py-3 text-slate-600">{co.offer_count.toLocaleString(locale)}</td>
                    <td className="px-4 py-3">
                      {co.has_proxy ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          {c("proxyDedicated")}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">{c("proxyGlobal")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setConfirmDel(co)}
                        className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title={c("deleteCompany")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filtered.length > perPage && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">
              {(pageClamped - 1) * perPage + 1}–{Math.min(pageClamped * perPage, filtered.length)} {c("of")}{" "}
              {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pageClamped <= 1}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <span className="px-2 text-slate-600">
                {pageClamped} / {lastPage}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={pageClamped >= lastPage}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}
      </Card>

      {selected !== null && (
        <CompanyDetailModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={refetch}
        />
      )}

      <CreateCompanyModal open={creating} onClose={() => setCreating(false)} onCreated={refetch} />

      <ConfirmModal
        open={confirmDel !== null}
        danger
        title={c("deleteCompany")}
        message={c("deleteConfirm").replace("{name}", confirmDel?.name ?? "")}
        confirmLabel={c("deleteCompany")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

function CreateCompanyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("DE");
  const [mgrName, setMgrName] = useState("");
  const [mgrEmail, setMgrEmail] = useState("");
  const [mgrPassword, setMgrPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setCountry("DE");
    setMgrName("");
    setMgrEmail("");
    setMgrPassword("");
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createCompany({
        name: name.trim(),
        country: country.trim() || undefined,
        manager_name: mgrName.trim() || undefined,
        manager_email: mgrEmail.trim() || undefined,
        manager_password: mgrPassword || undefined,
      });
      toast.success(c("createdToast"));
      reset();
      onCreated();
      onClose();
    } catch (e) {
      toast.error(c("createFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={c("newCompany")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {c("cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {c("create")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-start">
        <Field label={c("fieldName")} value={name} onChange={setName} />
        <Field label={c("fieldCountry")} value={country} onChange={setCountry} />
        <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {c("firstManager")}
        </p>
        <Field label={c("fieldManagerName")} value={mgrName} onChange={setMgrName} />
        <Field label={c("fieldManagerEmail")} type="email" value={mgrEmail} onChange={setMgrEmail} />
        <Field label={c("fieldManagerPassword")} type="password" value={mgrPassword} onChange={setMgrPassword} />
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}
