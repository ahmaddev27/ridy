"use client";

import { useEffect, useMemo, useState } from "react";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import { toast } from "sonner";
import { Radio, MapPin, ArrowRight, ChevronLeft, ChevronRight, ChevronDown, Inbox, CheckCircle2, XCircle, Gauge, Wallet, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Badge, type Status } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { listOffersPaged, getOfferStats, exportOffers, fareLabel, type DispatchOffer, type OfferStatus, type PageMeta, type OfferStats } from "@/lib/api/offers";
import { fleetNow } from "@/lib/fleet-day";
import { DateRangeFilter } from "@/components/ui/date-range-filter";

/** Offer lifecycle status → badge tone. */
const OFFER_TONE: Record<OfferStatus, Status> = {
  pending: "expiring",
  accepted: "info",
  started: "private",
  completed: "connected",
  rejected: "neutral",
  canceled: "personal",
};
import { StatCard } from "@/components/ui/card";
import { listDrivers, type Driver } from "@/lib/api/drivers";
import { OfferDetailModal } from "./offer-detail-modal";
import { AdBanner } from "@/components/ads/ad-banner";

export default function OffersPage() {
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

  // Deep link: /offers?offer=<id> (from the new-offer alert) opens that offer.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("offer"));
    if (id > 0) setDetailId(id);
  }, []);

  const [page, setPage] = useState(1);
  const [perPage] = useState(50); // fixed; offers are grouped by day, not paged by size
  // Collapsible day groups — today starts open, the rest collapsed.
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([fleetNow().toDateString()]));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Which quick-range chip is active (today / week / month), or null for a
  // manual range. Tracked separately so the chip can highlight and manual edits
  // clear it.
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [stats, setStats] = useState<OfferStats | null>(null);

  // A silent load (background poll) refreshes the feed in place: it keeps the
  // skeleton hidden and preserves the manager's current checkbox selection, so
  // new offers appear without disrupting anything on screen.
  async function load(silent = false) {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const { items, meta: m } = await listOffersPaged({
        search: search.trim(),
        driverUuids: driverUuids.length ? driverUuids : undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        perPage,
      });
      setOffers(items);
      setMeta(m);
      getOfferStats({
        search: search.trim(),
        driverUuids: driverUuids.length ? driverUuids : undefined,
        from: from || undefined,
        to: to || undefined,
      })
        .then(setStats)
        .catch(() => {});
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "error");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  const driverKey = driverUuids.join(",");

  // Filters/page-size reset to the first page.
  useEffect(() => {
    setPage(1);
  }, [search, driverKey, from, to, perPage]);

  // Debounce search + react to filter/page/page-size changes.
  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, driverKey, from, to, page, perPage]);

  // Near real-time: silently poll for new offers every 5s (offers are the most
  // time-sensitive surface). Also refetch when the tab regains focus.
  useEffect(() => {
    const id = setInterval(() => load(true), 5000);
    const onFocus = () => document.visibilityState === "visible" && load(true);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, driverKey, from, to, page, perPage]);

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
      const key = o.received_at ? fleetNow(new Date(o.received_at)).toDateString() : "—";
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
    if (key === fleetNow().toDateString()) return c("today");
    if (key === "—") return "—";
    return new Date(key).toLocaleDateString(latnLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  }


  return (
    <div className="space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Platform ad banner (super-admin authored); renders nothing when none live. */}
      <AdBanner />

      {/* Toolbar: search + driver filter + bulk delete */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder={c("searchPlaceholder")} className="flex-1" />
        {/* Multi-select driver filter — lists every company driver */}
        <div className="relative">
          <button
            onClick={() => setDriverFilterOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-muted outline-none hover:bg-surface-2"
          >
            {driverUuids.length === 0
              ? c("filterAll")
              : `${driverUuids.length} ${c("driversSelected")}`}
            <ChevronDown className="h-4 w-4 text-ink-subtle" />
          </button>
          {driverFilterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDriverFilterOpen(false)} />
              <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                {driverUuids.length > 0 && (
                  <button
                    onClick={() => setDriverUuids([])}
                    className="w-full rounded px-2 py-1.5 text-start text-xs font-medium text-ink hover:bg-surface-2"
                  >
                    {c("clearSelection")}
                  </button>
                )}
                {allDrivers.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-ink-subtle">{c("noDrivers")}</p>
                ) : (
                  allDrivers.map((d) => (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDriverSet.has(d.uber_driver_uuid ?? "")}
                        onChange={() => d.uber_driver_uuid && toggleDriver(d.uber_driver_uuid)}
                      />
                      <span className="truncate text-ink">{d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Uber-style date-range navigator (presets + custom + ‹ › stepping). */}
        <DateRangeFilter
          from={from}
          to={to}
          onChange={(f, t2) => {
            setFrom(f);
            setTo(t2);
            setPage(1);
          }}
        />

        <Button
          variant="secondary"
          onClick={handleExport}
          disabled={exporting}
          className="ms-auto"
        >
          <Download className="h-4 w-4" />
          {c("exportExcel")}
        </Button>
      </div>

      {/* Stat cards for the current filter */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={Inbox} label={c("statTotal")} value={stats.total.toLocaleString(latnLocale(locale))} />
          <StatCard icon={CheckCircle2} label={c("statAccepted")} value={stats.accepted.toLocaleString(latnLocale(locale))} tone="positive" />
          <StatCard icon={XCircle} label={c("statNotTaken")} value={stats.declined.toLocaleString(latnLocale(locale))} />
          <StatCard icon={Gauge} label={c("statRate")} value={`${stats.acceptance_rate}%`} tone={stats.acceptance_rate >= 50 ? "positive" : "default"} />
          <StatCard icon={Wallet} label={c("statEarnings")} value={`€${stats.earnings.toFixed(2)}`} tone="positive" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-danger-bg p-3 text-sm text-danger-fg">
          {c("loadError")} — {error}
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : offers.length === 0 ? (
          <EmptyState icon={Radio} title={c("empty")} description={c("emptyDesc")} />
        ) : (
          <div>
            {groupedByDay.map(([key, dayOffers]) => {
              const open = openDays.has(key);
              return (
                <div key={key} className="border-b border-line last:border-0">
                  <button
                    onClick={() => toggleDay(key)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-start hover:bg-surface-2"
                  >
                    <ChevronDown className={`h-4 w-4 text-ink-subtle transition ${open ? "" : "-rotate-90"}`} />
                    <span className="font-semibold text-ink">{dayLabel(key)}</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink">
                      {dayOffers.length} {c("offersCount")}
                    </span>
                  </button>
                  {open && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-line">
                          {dayOffers.map((o) => (
                            <tr
                              key={o.id}
                              onClick={() => setDetailId(o.id)}
                              className="cursor-pointer hover:bg-surface-2"
                            >
                              <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                                {o.received_at ? new Date(o.received_at).toLocaleTimeString(latnLocale(locale)) : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-ink">{o.driver_name ?? "—"}</div>
                                <div className="font-mono text-[10px] text-ink-subtle">{o.driver_uuid}</div>
                              </td>
                              <td className="px-4 py-3 text-ink-muted">
                                <div className="flex items-start gap-1.5">
                                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-fg" />
                                  <div className="min-w-0">
                                    <div className="truncate">{o.pickup_address ?? "—"}</div>
                                    <div className="flex items-center gap-1 truncate text-ink-subtle">
                                      <ArrowRight className="h-3 w-3 shrink-0 rtl:rotate-180" />
                                      <span className="truncate">{o.dropoff_address ?? "—"}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">
                                {toLatinDigits(fareLabel(o, latnLocale(locale)))}
                              </td>
                              <td className="px-4 py-3">
                                {(() => {
                                  const st = o.status ?? (o.accepted ? "accepted" : "pending");
                                  return <Badge status={OFFER_TONE[st]} dot>{c(`st_${st}`)}</Badge>;
                                })()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-muted">
              {(meta.current_page - 1) * meta.per_page + 1}–
              {Math.min(meta.current_page * meta.per_page, meta.total)} {c("of")} {meta.total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={meta.current_page <= 1}
                className="rounded-lg border border-line p-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40"
                aria-label={c("prev")}
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <span className="px-2 text-ink-muted">
                {meta.current_page} / {meta.last_page}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                disabled={meta.current_page >= meta.last_page}
                className="rounded-lg border border-line p-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40"
                aria-label={c("next")}
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}
      </Card>

      {detailId !== null && (
        <OfferDetailModal id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
