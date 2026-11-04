"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, latnLocale, toLatinDigits } from "@/lib/utils";
import { toast } from "sonner";
import { Radio, ChevronDown, Inbox, Check, CircleX, Gauge, Wallet, Download, Ban, Users, X } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { PageHead, SkelRows, StatTile, PagerBar } from "@/components/ui/rd";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { listOffersPaged, getOfferStats, exportOffers, fareLabel, type DispatchOffer, type PageMeta, type OfferStats } from "@/lib/api/offers";
import { fleetDayKey, fleetYmd, formatYmd } from "@/lib/fleet-day";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { OfferStatusBadge } from "@/components/ui/offer-status-badge";
import { DeclineOfferButton } from "./decline-offer-button";
import { OPEN_OFFER_EVENT } from "@/components/offer-alerts";
import { usePolling } from "@/hooks/use-polling";
import { listDrivers, type Driver } from "@/lib/api/drivers";
import { OfferDetailModal } from "./offer-detail-modal";
import { AdBanner } from "@/components/ads/ad-banner";
import { useAuth } from "@/components/auth/auth-provider";
import { useCompanyRealtime } from "@/lib/realtime";

export default function OffersPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.offers.${k}`);

  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [driverUuids, setDriverUuids] = useState<string[]>([]);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [driverFilterOpen, setDriverFilterOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const router = useRouter();
  // Stable identity so the modal's fetch effect doesn't re-run every render.
  // Closing also drops a ?offer= deep link so a reload doesn't reopen it.
  const closeDetail = useCallback(() => {
    setDetailId(null);
    if (new URLSearchParams(window.location.search).has("offer")) router.replace("/offers", { scroll: false });
  }, [router]);

  // Deep link: /offers?offer=<id> (from the new-offer alert) opens that offer.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("offer"));
    if (id > 0) setDetailId(id);
  }, []);

  // "View" on a new-offer toast while already on this page opens it in place
  // (router.push to the same route would not re-run the deep-link effect).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<number>).detail;
      if (typeof id === "number" && id > 0) setDetailId(id);
    };
    window.addEventListener(OPEN_OFFER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_OFFER_EVENT, onOpen);
  }, []);

  const [page, setPage] = useState(1);
  const [perPage] = useState(50); // fixed; offers are grouped by day, not paged by size
  // Collapsible day groups — today starts open, the rest collapsed.
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([fleetYmd()]));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [stats, setStats] = useState<OfferStats | null>(null);

  // Request sequencing: only the newest list/stats request may write state, so
  // a slow poll for an old filter can't overwrite the table after the filter
  // changed. `listLoading` also keeps silent polls from stacking on a visible load.
  const listSeq = useRef(0);
  const statsSeq = useRef(0);
  const listLoading = useRef(false);

  const filterParams = () => ({
    search: search.trim(),
    driverUuids: driverUuids.length ? driverUuids : undefined,
    from: from || undefined,
    to: to || undefined,
  });

  // A silent load (background poll / realtime) refreshes the feed in place: it
  // keeps the skeleton hidden, so new offers appear without disrupting anything.
  async function loadList(silent = false) {
    if (silent && listLoading.current) return;
    const my = ++listSeq.current;
    if (!silent) {
      listLoading.current = true;
      setLoading(true);
      setError(null);
    }
    try {
      const { items, meta: m } = await listOffersPaged({ ...filterParams(), page, perPage });
      if (my !== listSeq.current) return;
      setOffers(items);
      setMeta(m);
    } catch (e) {
      if (my === listSeq.current && !silent) setError(e instanceof Error ? e.message : "error");
      if (silent) throw e; // lets the poller back off
    } finally {
      if (!silent) listLoading.current = false;
      if (my === listSeq.current && !silent) setLoading(false);
    }
  }

  // The aggregates cover the whole filter (often the full offer history), so
  // they refresh on filter changes and on a slow timer — never on every poll.
  async function loadStats() {
    const my = ++statsSeq.current;
    try {
      const s = await getOfferStats(filterParams());
      if (my === statsSeq.current) setStats(s);
    } catch (e) {
      console.error("offer stats fetch failed", e);
    }
  }

  const driverKey = driverUuids.join(",");

  // Filters/page-size reset to the first page.
  useEffect(() => {
    setPage(1);
  }, [search, driverKey, from, to, perPage]);

  // React to filter/page changes: immediately, except typing in the search box
  // which is debounced.
  const lastSearch = useRef(search);
  useEffect(() => {
    const delay = lastSearch.current !== search ? 300 : 0;
    lastSearch.current = search;
    const id = setTimeout(() => void loadList(), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, driverKey, from, to, page, perPage]);

  const lastStatsSearch = useRef(search);
  useEffect(() => {
    const delay = lastStatsSearch.current !== search ? 300 : 0;
    lastStatsSearch.current = search;
    const id = setTimeout(() => void loadStats(), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, driverKey, from, to]);

  // Timers below call the latest loaders (current filters), never a stale closure.
  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;
  const loadStatsRef = useRef(loadStats);
  loadStatsRef.current = loadStats;

  // Background refresh (paused in hidden tabs, backs off on errors). Kept fast
  // even with the WebSocket up: offers of an unlinked driver get no "new"
  // broadcast, so only this poll surfaces them.
  usePolling(() => loadList(true), 5_000);
  usePolling(loadStats, 60_000);

  // Live: offer changes on the company channel refresh the list — coalesced so a
  // burst of events causes one request — and the stats a little later.
  const realtimeListTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeStatsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useCompanyRealtime(user?.tenant?.id, () => {
    if (realtimeListTimer.current) clearTimeout(realtimeListTimer.current);
    realtimeListTimer.current = setTimeout(() => void loadListRef.current(true).catch(() => {}), 1000);
    realtimeStatsTimer.current ??= setTimeout(() => {
      realtimeStatsTimer.current = null;
      void loadStatsRef.current();
    }, 15_000);
  });
  useEffect(
    () => () => {
      if (realtimeListTimer.current) clearTimeout(realtimeListTimer.current);
      if (realtimeStatsTimer.current) clearTimeout(realtimeStatsTimer.current);
    },
    [],
  );

  // All of the company's drivers (with an Uber UUID) populate the filter list.
  useEffect(() => {
    listDrivers()
      .then((list) => setAllDrivers(list.filter((d) => d.uber_driver_uuid)))
      .catch(() => {});
  }, []);

  const [exporting, setExporting] = useState(false);

  // Download the current filter set as a CSV (opens in Excel). Uses an
  // authenticated fetch (Sanctum cookie) then a temporary object URL to save.
  async function handleExport() {
    setExporting(true);
    try {
      const blob = await exportOffers({
        search: search.trim(),
        driverUuids: driverUuids.length ? driverUuids : undefined,
        from: from || undefined,
        to: to || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `offers_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(c("exportFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  const selectedDriverSet = useMemo(() => new Set(driverUuids), [driverUuids]);
  function toggleDriver(uuid: string) {
    setDriverUuids((prev) => (prev.includes(uuid) ? prev.filter((x) => x !== uuid) : [...prev, uuid]));
  }

  // Group the loaded offers into day buckets (feed is newest-first, so days stay ordered).
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, DispatchOffer[]>();
    for (const o of offers) {
      const key = o.received_at ? fleetDayKey(o.received_at) : "—";
      const bucket = groups.get(key) ?? [];
      bucket.push(o);
      groups.set(key, bucket);
    }
    return [...groups.entries()];
  }, [offers]);

  function toggleDay(key: string) {
    setOpenDays((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function dayLabel(key: string): string {
    if (key === fleetYmd()) return c("today");
    if (key === "—") return "—";
    return formatYmd(key, latnLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  }


  const nf = (n: number) => n.toLocaleString(latnLocale(locale));
  const cols = 6;

  return (
    <>
      <PageHead title={c("title")} sub={c("subtitle")} />

      {/* Platform ad banner (super-admin authored); renders nothing when none live. */}
      <AdBanner />

      {/* Toolbar: search + driver filter + date range + export */}
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder={c("searchPlaceholder")} />
        {/* Multi-select driver filter — lists every company driver */}
        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => setDriverFilterOpen((o) => !o)} className="btn btn-secondary" aria-haspopup="true" aria-expanded={driverFilterOpen}>
            <Users />
            <span className="lbl">{driverUuids.length === 0 ? c("filterAll") : `${driverUuids.length} ${c("driversSelected")}`}</span>
            <ChevronDown />
          </button>
          {driverFilterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDriverFilterOpen(false)} />
              <div className="menu" style={{ top: "calc(100% + 6px)", insetInlineStart: 0, width: 264, maxHeight: 288, overflow: "auto", padding: 2 }}>
                {driverUuids.length > 0 && (
                  <button type="button" onClick={() => setDriverUuids([])} style={{ color: "var(--primary)" }}>
                    <X />
                    {c("clearSelection")}
                  </button>
                )}
                {allDrivers.length === 0 ? (
                  <p className="subtle text-xs" style={{ padding: 10 }}>{c("noDrivers")}</p>
                ) : (
                  allDrivers.map((d) => (
                    <label key={d.id} className="check" style={{ padding: "7px 10px", borderRadius: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedDriverSet.has(d.uber_driver_uuid ?? "")}
                        onChange={() => d.uber_driver_uuid && toggleDriver(d.uber_driver_uuid)}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="strong truncate" style={{ display: "block", fontSize: 13 }}>{d.name}</span>
                        <span className="mono subtle" style={{ fontSize: 10 }}>{d.uber_driver_uuid}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Uber-style date-range navigator (presets + custom + ‹ › stepping). */}
        <DateRangeFilter
          fleetDays
          from={from}
          to={to}
          onChange={(f, t2) => {
            setFrom(f);
            setTo(t2);
            setPage(1);
          }}
        />

        <span style={{ marginInlineStart: "auto" }}>
          <button type="button" className="btn btn-secondary" onClick={handleExport} disabled={exporting}>
            <Download />
            {c("exportExcel")}
          </button>
        </span>
      </div>

      {/* Stat tiles for the current filter */}
      {stats && (
        <div className="kpi6">
          <StatTile icon={Inbox} label={c("statTotal")} value={nf(stats.total)} />
          <StatTile icon={Check} label={c("statAccepted")} value={nf(stats.accepted)} tone="success" toneValue />
          <StatTile icon={CircleX} label={c("statNotTaken")} value={nf(stats.declined)} />
          {/* Only for companies with dispatch-reject on (the admin switch): without
              it the tile would always read 0. Defaulted because frontend and backend
              ship separately. */}
          {user?.tenant?.dispatch_reject_enabled && (
            <StatTile
              icon={Ban}
              label={c("statDispatchDeclined")}
              value={nf(stats.dispatch_declined ?? 0)}
              tone="accent"
              foot={c("statDispatchDeclinedHint")}
            />
          )}
          <StatTile
            icon={Gauge}
            label={c("statRate")}
            value={`${stats.acceptance_rate}%`}
            tone={stats.acceptance_rate >= 50 ? "success" : ""}
            toneValue={stats.acceptance_rate >= 50}
          />
          <StatTile icon={Wallet} label={c("statEarnings")} value={formatMoney(stats.earnings, locale)} tone="success" toneValue />
        </div>
      )}

      {error && (
        <div className="callout danger">
          <div>
            {c("loadError")} — {error}
          </div>
        </div>
      )}

      <section className="card table-card">
        {loading ? (
          <SkelRows rows={6} cols={5} />
        ) : offers.length === 0 ? (
          <EmptyState icon={Radio} title={c("empty")} description={c("emptyDesc")} />
        ) : (
          <div className="table-wrap ofr-tbl">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{c("colTime")}</th>
                  <th>{c("colDriver")}</th>
                  <th>{c("colRoute")}</th>
                  <th className="r">{c("colFare")}</th>
                  <th>{c("colStatus")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groupedByDay.map(([key, dayOffers]) => {
                  const open = openDays.has(key);
                  return [
                    <tr key={`h-${key}`} className="day-row">
                      <td colSpan={cols}>
                        <button type="button" className="day-toggle" aria-expanded={open} onClick={() => toggleDay(key)}>
                          <ChevronDown />
                          <span>{dayLabel(key)}</span>
                          <span className="day-pill">
                            {dayOffers.length} {c("offersCount")}
                          </span>
                        </button>
                      </td>
                    </tr>,
                    ...(open ? dayOffers.map((o) => <OfferRow key={o.id} o={o} locale={locale} onOpen={setDetailId} />) : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {meta && meta.total > 0 && (
          <PagerBar
            range={`${(meta.current_page - 1) * meta.per_page + 1}–${Math.min(meta.current_page * meta.per_page, meta.total)} ${c("of")} ${meta.total}`}
            page={meta.current_page}
            lastPage={meta.last_page}
            onPage={setPage}
          />
        )}
      </section>

      {detailId !== null && <OfferDetailModal id={detailId} onClose={closeDetail} />}
    </>
  );
}

function OfferRow({ o, locale, onOpen }: { o: DispatchOffer; locale: string; onOpen: (id: number) => void }) {
  return (
    <tr className="clickable" onClick={() => onOpen(o.id)}>
      <td>
        {/* A real control so keyboard users can open the offer too. */}
        <button
          type="button"
          className="time-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(o.id);
          }}
        >
          {o.received_at ? new Date(o.received_at).toLocaleTimeString(latnLocale(locale)) : "—"}
        </button>
      </td>
      <td>
        <div className="strong truncate">{o.driver_name ?? "—"}</div>
        <div className="mono subtle" style={{ fontSize: 10 }}>{o.driver_uuid}</div>
      </td>
      <td>
        <div style={{ minWidth: 240, maxWidth: 400 }}>
          <div className="route">
            <span className="dotA" />
            <div className="truncate">{o.pickup_address ?? "—"}</div>
            <span className="via" />
            <span />
            <span className="dotB" />
            <div className="truncate">
              {o.dropoff_address ?? "—"}
              {o.stops_count != null && o.stops_count >= 2 && (
                <>
                  {" "}
                  <span className="badge warning square" style={{ height: 18, padding: "0 5px" }}>+{o.stops_count - 1}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="r">
        <span className="num strong nowrap">{toLatinDigits(fareLabel(o, latnLocale(locale)))}</span>
      </td>
      <td>
        <OfferStatusBadge offer={o} />
      </td>
      {/* Declining must not also open the detail modal. */}
      <td className="r" onClick={(e) => e.stopPropagation()}>
        <DeclineOfferButton offer={o} />
      </td>
    </tr>
  );
}
