"use client";

import { useMemo, useState } from "react";
import { latnLocale } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Trash2, ChevronLeft, ChevronRight, MailCheck, Power, PowerOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Badge, type Status } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listCompanies, deleteCompany, setCompanyActive, type Company } from "@/lib/api/admin";

type Filter = "all" | "linked" | "proxy" | "expired" | "banned";

const sessionTone: Record<string, Status> = {
  active: "connected",
  needs_relink: "expiring",
  expired: "error",
};

export default function CompaniesPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const c = (k: string) => t(`screens.companies.${k}`);
  const { data, loading, error, refetch } = useAsync(listCompanies, { refetchInterval: 15000 });
  const all = data ?? [];

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
      await deleteCompany(confirmDel.id);
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
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={c("searchPlaceholder")}
        />
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
                ? "border-ink bg-primary text-primary-ink"
                : "border-line bg-surface text-ink-muted hover:bg-surface-2")
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
              <div key={i} className="h-14 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-danger-fg">{c("loadError")} — {error}</div>
        ) : companies.length === 0 ? (
          <EmptyState icon={Building2} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
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
              <tbody className="divide-y divide-line">
                {companies.map((co) => (
                  <tr
                    key={co.id}
                    onClick={() => router.push(`/admin/companies/${co.id}`)}
                    className="cursor-pointer hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{co.name}</div>
                      <div className="text-xs text-ink-subtle">{co.country ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge status={co.status === "active" ? "connected" : "neutral"} dot>
                          {co.status === "active" ? c("statusActive") : c("statusDisabled")}
                        </Badge>
                        {co.email_verified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success-fg">
                            <MailCheck className="h-3 w-3" /> {c("emailVerified")}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-subtle">{c("emailUnverified")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {co.session_status ? (
                        <Badge status={sessionTone[co.session_status] ?? "gap"} dot>
                          {c(`session_${co.session_status}`)}
                        </Badge>
                      ) : (
                        <span className="text-ink-subtle">{c("noSession")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{co.driver_count.toLocaleString(latnLocale(locale))}</td>
                    <td className="px-4 py-3 text-ink-muted">{co.offer_count.toLocaleString(latnLocale(locale))}</td>
                    <td className="px-4 py-3">
                      {co.has_proxy ? (
                        <span className="rounded bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success-fg">
                          {c("proxyDedicated")}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-subtle">{c("proxyGlobal")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => toggleActive(co)}
                          className={
                            "rounded p-1.5 " +
                            (co.status === "active"
                              ? "text-ink-subtle hover:bg-warning-bg hover:text-warning-fg"
                              : "text-ink-subtle hover:bg-success-bg hover:text-success-fg")
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
                          className="rounded p-1.5 text-ink-subtle hover:bg-danger-bg hover:text-danger-fg"
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
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-muted">
              {(pageClamped - 1) * perPage + 1}–{Math.min(pageClamped * perPage, filtered.length)} {c("of")}{" "}
              {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pageClamped <= 1}
                className="rounded-lg border border-line p-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <span className="px-2 text-ink-muted">
                {pageClamped} / {lastPage}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={pageClamped >= lastPage}
                className="rounded-lg border border-line p-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}
      </Card>


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

