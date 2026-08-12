"use client";

import { useEffect, useMemo, useState } from "react";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import { toast } from "sonner";
import { Radio, MapPin, Search, ArrowRight, ChevronLeft, ChevronRight, ChevronDown, Inbox, CheckCircle2, XCircle, Gauge, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { listOffersPaged, getOfferStats, type DispatchOffer, type PageMeta, type OfferStats } from "@/lib/api/offers";
import { StatCard } from "@/components/ui/card";
import { listDrivers, type Driver } from "@/lib/api/drivers";
import { OfferDetailModal } from "./offer-detail-modal";

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
  const [page, setPage] = useState(1);
  const [perPage] = useState(50); // fixed; offers are grouped by day, not paged by size
  // Collapsible day groups — today starts open, the rest collapsed.
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([new Date().toDateString()]));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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

  const selectedDriverSet = useMemo(() => new Set(driverUuids), [driverUuids]);
  function toggleDriver(uuid: string) {
    setDriverUuids((prev) => (prev.includes(uuid) ? prev.filter((x) => x !== uuid) : [...prev, uuid]));
  }

  // Group the loaded offers into day buckets (feed is newest-first, so days stay ordered).
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, DispatchOffer[]>();
    for (const o of offers) {
      const key = o.received_at ? new Date(o.received_at).toDateString() : "—";
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
    if (key === new Date().toDateString()) return c("today");
    if (key === "—") return "—";
    return new Date(key).toLocaleDateString(latnLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  }


  return (
    <div className="space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Toolbar: search + driver filter + bulk delete */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={c("searchPlaceholder")}
            className="w-full rounded-lg border border-slate-300 py-2 ps-9 pe-3 text-sm outline-none focus:border-black focus:ring-2 focus:ring-slate-200"
          />
        </div>
        {/* Multi-select driver filter — lists every company driver */}
        <div className="relative">
          <button
            onClick={() => setDriverFilterOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 outline-none hover:bg-slate-50"
          >
            {driverUuids.length === 0
              ? c("filterAll")
              : `${driverUuids.length} ${c("driversSelected")}`}
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
          {driverFilterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDriverFilterOpen(false)} />
              <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                {driverUuids.length > 0 && (
                  <button
                    onClick={() => setDriverUuids([])}
                    className="w-full rounded px-2 py-1.5 text-start text-xs font-medium text-slate-900 hover:bg-slate-100"
                  >
                    {c("clearSelection")}
                  </button>
                )}
                {allDrivers.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-400">{c("noDrivers")}</p>
                ) : (
                  allDrivers.map((d) => (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDriverSet.has(d.uber_driver_uuid ?? "")}
                        onChange={() => d.uber_driver_uuid && toggleDriver(d.uber_driver_uuid)}
                      />
                      <span className="truncate text-slate-700">{d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Date range */}
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          title={c("dateFrom")}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 outline-none focus:border-black"
        />
        <span className="text-slate-400">–</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          title={c("dateTo")}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 outline-none focus:border-black"
        />
        {(from || to) && (
          <button
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="text-xs font-medium text-slate-900 hover:underline"
          >
            {c("clearDates")}
          </button>
        )}

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
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {c("loadError")} — {error}
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : offers.length === 0 ? (
          <EmptyState icon={Radio} title={c("empty")} description={c("emptyDesc")} />
        ) : (
          <div>
            {groupedByDay.map(([key, dayOffers]) => {
              const open = openDays.has(key);
              return (
                <div key={key} className="border-b border-slate-100 last:border-0">
                  <button
                    onClick={() => toggleDay(key)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-start hover:bg-slate-50"
                  >
                    <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "" : "-rotate-90"}`} />
                    <span className="font-semibold text-slate-800">{dayLabel(key)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                      {dayOffers.length} {c("offersCount")}
                    </span>
                  </button>
                  {open && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {dayOffers.map((o) => (
                            <tr
                              key={o.id}
                              onClick={() => setDetailId(o.id)}
                              className="cursor-pointer hover:bg-slate-50"
                            >
                              <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                                {o.received_at ? new Date(o.received_at).toLocaleTimeString(latnLocale(locale)) : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-800">{o.driver_name ?? "—"}</div>
                                <div className="font-mono text-[10px] text-slate-400">{o.driver_uuid}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-600">
                                <div className="flex items-start gap-1.5">
                                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                  <div className="min-w-0">
                                    <div className="truncate">{o.pickup_address ?? "—"}</div>
                                    <div className="flex items-center gap-1 truncate text-slate-400">
                                      <ArrowRight className="h-3 w-3 shrink-0 rtl:rotate-180" />
                                      <span className="truncate">{o.dropoff_address ?? "—"}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                                {toLatinDigits(o.fare_formatted) || "—"}
                              </td>
                              <td className="px-4 py-3">
                                <Badge status={o.accepted ? "connected" : "neutral"} dot>
                                  {o.accepted ? c("accepted") : c("notAccepted")}
                                </Badge>
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
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">
              {(meta.current_page - 1) * meta.per_page + 1}–
              {Math.min(meta.current_page * meta.per_page, meta.total)} {c("of")} {meta.total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={meta.current_page <= 1}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                aria-label={c("prev")}
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <span className="px-2 text-slate-600">
                {meta.current_page} / {meta.last_page}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                disabled={meta.current_page >= meta.last_page}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
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
