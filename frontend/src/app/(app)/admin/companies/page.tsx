"use client";

import { useMemo, useState } from "react";
import { latnLocale } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Trash2, ChevronLeft, ChevronRight, Power, PowerOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Badge, type Status } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listCompanies, deleteCompany, setCompanyActive, setCompanyElProfessor, type Company } from "@/lib/api/admin";
import { apiErrorMessage } from "@/lib/api/error-message";

type Filter = "all" | "linked" | "expired" | "banned";

const sessionTone: Record<string, Status> = {
  active: "connected",
  needs_relink: "expiring",
  expired: "error",
};

/** A paid/free subscription that hasn't lapsed yet. */
const subActive = (co: Company): boolean =>
  co.subscription_ends_at !== null && new Date(co.subscription_ends_at).getTime() > Date.now();

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
      expired: all.filter((c) => c.state === "expired").length,
    }),
    [all],
  );

  const lastPage = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageClamped = Math.min(page, lastPage);
  const companies = filtered.slice((pageClamped - 1) * perPage, pageClamped * perPage);

  // The change being confirmed — the company and the direction — or null
  // while nothing is asked. The direction is held here rather than read off
  // the row again at confirm time, so a refetch landing while the dialog is
  // open cannot turn an "open this" into a "close this" under the cursor.
  const [confirmEp, setConfirmEp] = useState<{ co: Company; next: boolean } | null>(null);
  // Its own flag: `busy` belongs to the delete dialog, and sharing it would
  // grey out whichever of the two the operator is not looking at.
  const [epBusy, setEpBusy] = useState(false);

  async function toggleActive(co: Company) {
    const next = co.status !== "active";
    try {
      await setCompanyActive(co.id, next);
      toast.success(next ? c("enabledToast") : c("disabledToast"));
      await refetch();
    } catch (e) {
      toast.error(c("updateFailed"), { description: apiErrorMessage(e, t, locale) });
    }
  }

  /**
   * Open or close the El-Professor link for one company.
   *
   * **Both directions ask first.** Closing ends a live connection rather than
   * pausing it: the company's token is deleted, El-Professor stops reading,
   * and its drivers lose the receipts and notes section — and re-opening
   * does not bring it back, a new token has to be issued and pasted. Opening
   * is the lighter act, but it is still the platform granting a company an
   * integration, and it sits one row away from twenty-four others.
   *
   * The older version asked only when closing a *connected* company, which
   * let a stray click close an open-but-not-yet-linked one in silence — and
   * that still revokes whatever token is in flight.
   */
  function toggleElProfessor(co: Company) {
    setConfirmEp({ co, next: !co.elprofessor_enabled });
  }

  async function applyElProfessor() {
    if (!confirmEp) return;
    const { co, next } = confirmEp;
    setEpBusy(true);
    try {
      await setCompanyElProfessor(co.id, next);
      toast.success(next ? c("epEnabledToast") : c("epDisabledToast"));
      await refetch();
    } catch (e) {
      toast.error(c("updateFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setEpBusy(false);
      setConfirmEp(null);
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
      toast.error(c("deleteFailed"), { description: apiErrorMessage(e, t, locale) });
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
        {(["all", "linked", "expired", "banned"] as Filter[]).map((f) => (
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
                  <th className="px-4 py-3 font-semibold">{c("colElProfessor")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colDrivers")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colOffers")}</th>
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
                      <Link
                        href={`/admin/companies/${co.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {co.name}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-ink-subtle">
                        <span>{co.country ?? "—"}</span>
                        {co.payment_reference && (
                          <span className="font-mono" dir="ltr">· {co.payment_reference}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge status={subActive(co) ? "connected" : "error"} dot>
                          {subActive(co) ? c("subOk") : c("subNone")}
                        </Badge>
                        {co.subscription_ends_at && (
                          <span className="text-[11px] text-ink-subtle">
                            {new Date(co.subscription_ends_at).toLocaleDateString(latnLocale(locale))}
                          </span>
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
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {/* The switch is `enabled`, the platform's own decision.
                          The word beside it is the second fact the switch
                          cannot carry: whether the company has actually
                          completed the link. A company can be open and not yet
                          connected, and that is precisely the row the operator
                          is looking for — the one that still owes the paste. */}
                      <div className="flex items-center gap-2.5">
                        <Switch
                          checked={co.elprofessor_enabled}
                          onChange={() => toggleElProfessor(co)}
                          disabled={epBusy}
                          label={co.elprofessor_enabled ? c("epClose") : c("epOpen")}
                        />
                        <span
                          className={
                            "whitespace-nowrap text-xs " +
                            (!co.elprofessor_enabled
                              ? "text-ink-subtle"
                              : co.elprofessor_connected
                                ? "text-success-fg"
                                : // amber: open, and still waiting on the company
                                  "text-warning-fg")
                          }
                        >
                          {!co.elprofessor_enabled
                            ? c("epClosed")
                            : co.elprofessor_connected
                              ? c("epConnected")
                              : c("epOpenNotLinked")}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{co.driver_count.toLocaleString(latnLocale(locale))}</td>
                    <td className="px-4 py-3 text-ink-muted">{co.offer_count.toLocaleString(latnLocale(locale))}</td>
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

      {/* Both directions ask. Only closing is `danger`, because only closing
          destroys something: the token dies, the drivers lose the section, and
          re-opening does not bring the link back — a new token has to be
          issued and pasted. */}
      <ConfirmModal
        open={confirmEp !== null}
        danger={confirmEp !== null && !confirmEp.next}
        title={confirmEp?.next ? c("epOpen") : c("epClose")}
        message={(confirmEp?.next ? c("epOpenConfirm") : c("epCloseConfirm")).replace(
          "{name}",
          confirmEp?.co.name ?? "",
        )}
        confirmLabel={confirmEp?.next ? c("epOpen") : c("epClose")}
        cancelLabel={c("cancel")}
        busy={epBusy}
        onConfirm={applyElProfessor}
        onCancel={() => setConfirmEp(null)}
      />
    </div>
  );
}

