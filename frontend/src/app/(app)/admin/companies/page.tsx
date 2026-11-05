"use client";

import { useMemo, useState } from "react";
import { latnLocale } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Trash2, Power, PowerOff } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Badge, type Status } from "@/components/ui/badge";
import { Pager } from "@/components/ui/pager";
import { Table, TableCard } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listCompanies, deleteCompany, setCompanyActive, setCompanyElProfessor, setCompanyDispatchReject, type Company } from "@/lib/api/admin";
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
  // Only turning declines ON asks first; the company being confirmed is held
  // here so a refetch while the dialog is open cannot change which row it acts on.
  const [confirmDr, setConfirmDr] = useState<Company | null>(null);
  const [drBusy, setDrBusy] = useState(false);

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

  /**
   * Turning declines ON asks first: Reidey starts sending real decline requests
   * to Uber for that company's live offers. Turning OFF is the kill switch and
   * applies at once — it revokes nothing, so there is nothing to confirm.
   */
  function toggleDispatchReject(co: Company) {
    if (co.dispatch_reject_enabled) {
      void applyDispatchReject(co, false);
    } else {
      setConfirmDr(co);
    }
  }

  async function applyDispatchReject(co: Company, next: boolean) {
    setDrBusy(true);
    try {
      await setCompanyDispatchReject(co.id, next);
      toast.success(next ? c("drEnabledToast") : c("drDisabledToast"));
      await refetch();
    } catch (e) {
      toast.error(c("updateFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setDrBusy(false);
      setConfirmDr(null);
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
    <div className="stack-lg">
      <header className="ph">
        <div>
          <h1>{t("pages.companies.title")}</h1>
          <p>{t("pages.companies.subtitle")}</p>
        </div>
      </header>

      {/* Toolbar: search + filter chips */}
      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={c("searchPlaceholder")}
        />
        <div className="row-wrap" role="group" aria-label={c("filter_all")}>
          {(["all", "linked", "expired", "banned"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={"chip" + (filter === f ? " on" : "")}
              aria-pressed={filter === f}
            >
              {c(`filter_${f}`)} <span className="n">{counts[f].toLocaleString(latnLocale(locale))}</span>
            </button>
          ))}
        </div>
      </div>

      <TableCard>
        {loading ? (
          <div className="stack p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel" style={{ height: 52 }} />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-danger-fg">{c("loadError")} — {error}</div>
        ) : companies.length === 0 ? (
          <EmptyState icon={Building2} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{c("colName")}</th>
                <th>{c("colStatus")}</th>
                <th>{c("colConnection")}</th>
                <th>{c("colElProfessor")}</th>
                <th>{c("colDispatchReject")}</th>
                <th className="r">{c("colDrivers")}</th>
                <th className="r">{c("colOffers")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {companies.map((co) => (
                <tr
                  key={co.id}
                  onClick={() => router.push(`/admin/companies/${co.id}`)}
                  className="cursor-pointer"
                >
                  <td>
                    <Link
                      href={`/admin/companies/${co.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {co.name}
                    </Link>
                    <div className="subtle text-xs">
                      {co.country ?? "—"}
                      {co.payment_reference && (
                        <span className="mono" dir="ltr"> · {co.payment_reference}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="stack-sm" style={{ alignItems: "flex-start", gap: 4 }}>
                      <Badge status={subActive(co) ? "connected" : "error"} dot>
                        {subActive(co) ? c("subOk") : c("subNone")}
                      </Badge>
                      {co.subscription_ends_at && (
                        <span className="subtle text-xs num">
                          {new Date(co.subscription_ends_at).toLocaleDateString(latnLocale(locale))}
                        </span>
                      )}
                      {co.banned && <Badge status="error">{c("sub_banned")}</Badge>}
                      {!co.banned && co.state === "expired" && <Badge status="expiring">{c("sub_expired")}</Badge>}
                    </div>
                  </td>
                  <td>
                    {/* One connection cell: session state, last event, then the
                        two supporting facts (proxy, passkey) as small badges. */}
                    <div className="stack-sm" style={{ alignItems: "flex-start", gap: 4 }}>
                      {co.session_status ? (
                        <Badge status={sessionTone[co.session_status] ?? "gap"} dot>
                          {c(`session_${co.session_status}`)}
                        </Badge>
                      ) : (
                        <span className="muted">{c("noSession")}</span>
                      )}
                      {co.session_last_event_at && (
                        <span className="subtle text-xs num" dir="ltr">
                          {c("lastEvent")}:{" "}
                          {new Date(co.session_last_event_at).toLocaleString(latnLocale(locale), {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                      )}
                      <div className="row-wrap" style={{ gap: 4 }}>
                        <Badge status={co.has_proxy ? "connected" : "gap"}>
                          {co.has_proxy ? c("proxySet") : c("proxyNone")}
                        </Badge>
                        <Badge status={co.passkey.registered ? "connected" : "gap"}>
                          {co.passkey.registered ? `✓ ${c("passkeyRegistered")}` : `✗ ${c("passkeyNone")}`}
                        </Badge>
                      </div>
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {/* The switch is `enabled`, the platform's own decision.
                        The word beside it is the second fact the switch
                        cannot carry: whether the company has actually
                        completed the link. A company can be open and not yet
                        connected, and that is precisely the row the operator
                        is looking for — the one that still owes the paste. */}
                    <div className="row-wrap" style={{ gap: 10, flexWrap: "nowrap" }}>
                      <Switch
                        checked={co.elprofessor_enabled}
                        onChange={() => toggleElProfessor(co)}
                        disabled={epBusy}
                        label={co.elprofessor_enabled ? c("epClose") : c("epOpen")}
                      />
                      <span
                        className={
                          "nowrap text-xs " +
                          (!co.elprofessor_enabled
                            ? "subtle"
                            : co.elprofessor_connected
                              ? "pos"
                              : // amber: open, and still waiting on the company
                                "warn")
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
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row-wrap" style={{ gap: 10, flexWrap: "nowrap" }}>
                      <Switch
                        checked={co.dispatch_reject_enabled}
                        onChange={() => toggleDispatchReject(co)}
                        disabled={drBusy}
                        label={co.dispatch_reject_enabled ? c("drOff") : c("drOn")}
                      />
                      <span className={"text-xs " + (co.dispatch_reject_enabled ? "pos" : "subtle")}>
                        {co.dispatch_reject_enabled ? c("stateOn") : c("stateOff")}
                      </span>
                    </div>
                  </td>
                  <td className="r num">{co.driver_count.toLocaleString(latnLocale(locale))}</td>
                  <td className="r num">{co.offer_count.toLocaleString(latnLocale(locale))}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      <button
                        type="button"
                        onClick={() => toggleActive(co)}
                        className="icon-btn"
                        title={co.status === "active" ? c("disableCompany") : c("enableCompany")}
                        aria-label={co.status === "active" ? c("disableCompany") : c("enableCompany")}
                      >
                        {co.status === "active" ? <PowerOff /> : <Power />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDel(co)}
                        className="icon-btn"
                        title={c("deleteCompany")}
                        aria-label={c("deleteCompany")}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {filtered.length > perPage && (
          <div className="tbl-foot">
            <span className="num">
              {(pageClamped - 1) * perPage + 1}–{Math.min(pageClamped * perPage, filtered.length)} {c("of")}{" "}
              {filtered.length}
            </span>
            <Pager page={pageClamped} lastPage={lastPage} onPage={setPage} />
          </div>
        )}
      </TableCard>

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

      {/* Only ever opened for "turn on" — turning off skips the dialog. Not
          `danger`: nothing is destroyed, it is an opt-in to a real write. */}
      <ConfirmModal
        open={confirmDr !== null}
        title={c("drOn")}
        message={c("drOnConfirm").replace("{name}", confirmDr?.name ?? "")}
        confirmLabel={c("drOnConfirmLabel")}
        cancelLabel={c("cancel")}
        busy={drBusy}
        onConfirm={() => confirmDr && applyDispatchReject(confirmDr, true)}
        onCancel={() => setConfirmDr(null)}
      />
    </div>
  );
}

