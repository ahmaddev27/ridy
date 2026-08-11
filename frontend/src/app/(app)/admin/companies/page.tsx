"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Search, Trash2, ChevronLeft, ChevronRight, MailCheck, Power, PowerOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listCompanies, disableCompany, setCompanyActive, type Company } from "@/lib/api/admin";
import { CompanyDetailModal } from "./company-detail-modal";

type Filter = "all" | "linked" | "proxy" | "expired" | "banned";

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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [confirmDel, setConfirmDel] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  const matchesFilter = (co: Company): boolean => {
    switch (filter) {
      case "banned":
        return co.banned;
      case "linked":
        return co.session_status === "active"; // Uber fleet session live
      case "proxy":
        return co.has_proxy;
      case "expired":
        return co.state === "expired";
      default:
        return true;
    }
  };

  // Client-side search + filter + pagination (the company list is small).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((co) => {
      if (!matchesFilter(co)) return false;
      if (!q) return true;
      return [co.name, co.country, co.uber_org_uuid].some((v) => (v ?? "").toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, filter]);

  const counts = useMemo(
    () => ({
      all: all.length,
      banned: all.filter((c) => c.banned).length,
      linked: all.filter((c) => c.session_status === "active").length,
      proxy: all.filter((c) => c.has_proxy).length,
      expired: all.filter((c) => c.state === "expired").length,
    }),
    [all],
  );

  const lastPage = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageClamped = Math.min(page, lastPage);
  const companies = filtered.slice((pageClamped - 1) * perPage, pageClamped * perPage);

  async function toggleActive(co: Company) {
    const next = co.status !== "active";
    try {
      await setCompanyActive(co.id, next);
      toast.success(next ? c("enabledToast") : c("disabledToast"));
      await refetch();
    } catch (e) {
      toast.error(c("updateFailed"), { description: e instanceof Error ? e.message : undefined });
    }
  }

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
      <PageHeader tkey="companies" />

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

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(["all", "linked", "proxy", "expired", "banned"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
              (filter === f
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
            }
          >
            {c(`filter_${f}`)} <span className="opacity-60">{counts[f]}</span>
          </button>
        ))}
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
                      <div className="flex flex-col items-start gap-1">
                        <Badge status={co.status === "active" ? "connected" : "neutral"} dot>
                          {co.status === "active" ? c("statusActive") : c("statusDisabled")}
                        </Badge>
                        {co.email_verified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                            <MailCheck className="h-3 w-3" /> {c("emailVerified")}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">{c("emailUnverified")}</span>
                        )}
                      </div>
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
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => toggleActive(co)}
                          className={
                            "rounded p-1.5 " +
                            (co.status === "active"
                              ? "text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                              : "text-slate-400 hover:bg-emerald-50 hover:text-emerald-600")
                          }
                          title={co.status === "active" ? c("disableCompany") : c("enableCompany")}
                        >
                          {co.status === "active" ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmDel(co)}
                          className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title={c("deleteCompany")}
                        >
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

