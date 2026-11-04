"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Phone, Mail, Star, Car, Link2, ChevronDown, Inbox, RotateCcw, Users, BadgeCheck, Database } from "lucide-react";
import { Av, SkelRows, type Presence } from "@/components/ui/rd";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { formatMoney, formatNumber, latnLocale, toLatinDigits } from "@/lib/utils";
import { ApiError } from "@/lib/api/client";
import { getDriver, getDriverStats, getDriverMetrics, type Driver, type DriverStats, type DriverMetric } from "@/lib/api/drivers";
import { listOffersPaged, fareLabel, type DispatchOffer, type PageMeta } from "@/lib/api/offers";
import { OfferStatusBadge } from "@/components/ui/offer-status-badge";
import { fleetDayKey, fleetDayRange, fleetYmd, formatYmd } from "@/lib/fleet-day";
import { OfferDetailModal } from "../../offers/offer-detail-modal";

type RangeKey = "today" | "yesterday" | "7" | "30" | "custom";

// Uber measures a "day" as its business day: 04:00 → 04:00 Europe/Berlin, NOT
// local midnight. The backend filters take INCLUSIVE fleet-day labels (to =
// FleetDay::endOfDate = next day 04:00), so the presets are built as labels —
// "yesterday" is one fleet-day, "7d" exactly seven.
function rangeLabels(key: Exclude<RangeKey, "custom">): { from: string; to: string } {
  if (key === "today") return fleetDayRange(1, 0);
  if (key === "yesterday") return fleetDayRange(1, 1);
  return fleetDayRange(Number(key), 0);
}

/** "cash_collected" → its localized label, or "Cash collected" for unknown Uber keys. */
function prettyCat(cat: string, t: (k: string) => string): string {
  const key = `screens.drivers.earningsCat.${cat}`;
  const localized = t(key);
  if (localized !== key) return localized;
  const s = cat.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "12 Aug – 19 Aug" for a captured earnings window. */
function uberPeriod(m: DriverMetric, loc: string): string {
  const fmt = (s: string) => new Date(s).toLocaleDateString(loc, { day: "numeric", month: "short" });
  return `${fmt(m.period_start)} – ${fmt(m.period_end)}`;
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasUberPerformance(m: DriverMetric): boolean {
  return [m.hours_online, m.hours_on_trip, m.acceptance_rate, m.cancellation_rate].some((v) => numOrNull(v) !== null);
}

function hoursLabel(v: number | string | null | undefined, loc: string): string {
  const n = numOrNull(v);
  return n === null ? "—" : `${formatNumber(Math.round(n * 10) / 10, loc)} h`;
}

/** Uber may send a 0-1 fraction or a 0-100 percentage; normalise to a percentage. */
function pctLabel(v: number | string | null | undefined, loc: string): string {
  const n = numOrNull(v);
  if (n === null) return "—";
  const pct = n <= 1 ? n * 100 : n;
  return `${formatNumber(Math.round(pct * 10) / 10, loc)}%`;
}

function statusLabel(driver: Driver, d: (k: string) => string): { text: string; color: string } {
  const s = (driver.online_status ?? "").toUpperCase();
  if (s.includes("ON_TRIP")) return { text: d("onTrip"), color: "var(--success-fg)" };
  if (s.includes("EN_ROUTE")) return { text: d("enRoute"), color: "var(--warning-fg)" };
  if (driver.online) return { text: d("online"), color: "var(--success-fg)" };
  return { text: d("offline"), color: "var(--ink-subtle)" };
}

export default function DriverProfilePage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const extensionRetired = user?.tenant?.extension_retired === true;
  const d = (k: string) => t(`screens.drivers.${k}`);
  const o = (k: string) => t(`screens.offers.${k}`);
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [driver, setDriver] = useState<Driver | null>(null);
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [uber, setUber] = useState<DriverMetric | null>(null);
  const [tab, setTab] = useState<"performance" | "details">("performance");
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [offersMeta, setOffersMeta] = useState<PageMeta | null>(null);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  // Stable identity so the modal's fetch effect doesn't re-run every render.
  const closeDetail = useCallback(() => setDetailId(null), []);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([fleetYmd()]));
  const [driverError, setDriverError] = useState<number | null>(null);
  const [driverAttempt, setDriverAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDriverError(null);
    getDriver(id)
      .then((d) => !cancelled && setDriver(d))
      .catch((e) => {
        if (cancelled) return;
        setDriver(null);
        setDriverError(e instanceof ApiError ? e.status : 0);
      });
    return () => {
      cancelled = true;
    };
  }, [id, driverAttempt]);

  // The active window as inclusive fleet-day labels (YYYY-MM-DD), from a preset
  // or a custom from→to range.
  const win = useMemo(() => {
    if (range === "custom") return { fromDate: customFrom || undefined, toDate: customTo || undefined };
    const { from, to } = rangeLabels(range);
    return { fromDate: from, toDate: to };
  }, [range, customFrom, customTo]);

  // Our own stats respect the same window. Cancelled on range change so a slow
  // 30-day query can't land under the "Today" chip.
  useEffect(() => {
    let cancelled = false;
    getDriverStats(id, win.fromDate, win.toDate)
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setStats(null));
    return () => {
      cancelled = true;
    };
  }, [id, win.fromDate, win.toDate]);

  // Uber's OFFICIAL earnings (synced server-side from Uber). We show the
  // most recent captured window, regardless of the selected preset, since Uber's
  // period is whatever the manager last viewed on Uber.
  useEffect(() => {
    let cancelled = false;
    getDriverMetrics(id)
      .then((m) => !cancelled && setUber(m[0] ?? null))
      .catch(() => !cancelled && setUber(null));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Extension companies: on open, ask the extension to refresh this driver's Uber
  // earnings on demand (replays getEarnerBreakdownsV2 → backend), so earnings are
  // current without the manager reopening the Uber tab. Migrated companies are
  // synced server-side.
  useEffect(() => {
    const uuid = driver?.uber_driver_uuid;
    if (!uuid || extensionRetired) return;
    function onDone(e: MessageEvent) {
      if (e.source !== window || (e.data as { source?: string })?.source !== "ridy-driver-uber-done") return;
      const d = e.data as { breakdown?: boolean };
      if (d.breakdown) getDriverMetrics(id).then((m) => setUber(m[0] ?? null)).catch(() => {});
    }
    window.addEventListener("message", onDone);
    window.postMessage({ source: "ridy-fetch-driver-uber", driverUuid: uuid }, "*");
    return () => window.removeEventListener("message", onDone);
  }, [driver?.uber_driver_uuid, id, extensionRetired]);

  // This driver's own captured offers for the selected window.
  useEffect(() => {
    const uuid = driver?.uber_driver_uuid;
    if (!uuid) {
      setOffers([]);
      return;
    }
    let cancelled = false;
    setLoadingOffers(true);
    setOffersMeta(null);
    listOffersPaged({ driverUuid: uuid, from: win.fromDate, to: win.toDate, perPage: 100 })
      .then((res) => {
        if (cancelled) return;
        setOffers(res.items);
        setOffersMeta(res.meta);
      })
      .catch(() => !cancelled && setOffers([]))
      .finally(() => !cancelled && setLoadingOffers(false));
    return () => {
      cancelled = true;
    };
  }, [driver?.uber_driver_uuid, win.fromDate, win.toDate]);

  // More than one page (busy driver, long range): append the next page instead
  // of silently capping the list at 100.
  const hasMoreOffers = offersMeta != null && offersMeta.current_page < offersMeta.last_page;
  const windowKey = useRef("");
  windowKey.current = `${driver?.uber_driver_uuid}|${win.fromDate}|${win.toDate}`;
  async function loadMoreOffers() {
    const uuid = driver?.uber_driver_uuid;
    if (!uuid || !offersMeta || loadingMore) return;
    const key = `${uuid}|${win.fromDate}|${win.toDate}`;
    setLoadingMore(true);
    try {
      const res = await listOffersPaged({
        driverUuid: uuid,
        from: win.fromDate,
        to: win.toDate,
        perPage: 100,
        page: offersMeta.current_page + 1,
      });
      // Ignore the page if the window changed while it loaded.
      if (key !== windowKey.current) return;
      setOffers((prev) => [...prev, ...res.items]);
      setOffersMeta(res.meta);
    } catch {
      /* keep what we have; the button stays for a retry */
    } finally {
      setLoadingMore(false);
    }
  }

  // Group the loaded offers into fleet-day buckets (feed is newest-first).
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, DispatchOffer[]>();
    for (const offer of offers) {
      const key = offer.received_at ? fleetDayKey(offer.received_at) : "—";
      const bucket = groups.get(key) ?? [];
      bucket.push(offer);
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
    if (key === fleetYmd()) return o("today");
    if (key === "—") return "—";
    return formatYmd(key, latnLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  }

  const status = driver ? statusLabel(driver, d) : null;
  const money = (amount: number | string | null | undefined, label: string | null) =>
    formatMoney(amount, locale, label || "EUR");

  const presence: Presence = (() => {
    const s = (driver?.online_status ?? "").toUpperCase();
    if (s.includes("ON_TRIP")) return "on_trip";
    if (s.includes("EN_ROUTE")) return "en_route";
    return driver?.online ? "online" : "offline";
  })();

  const backLink = (
    <Link href="/drivers" className="back-link">
      <ArrowLeft className="ico-sm rtl:rotate-180" />
      {d("backToDrivers")}
    </Link>
  );

  if (driverError != null) {
    return (
      <>
        {backLink}
        <section className="card">
          <div className="empty">
            <span className="empty-ico">
              <Users />
            </span>
            <p>{driverError === 404 || driverError === 403 ? d("notFound") : t("common.loadFailed")}</p>
            {driverError !== 404 && driverError !== 403 && (
              <button type="button" className="btn btn-secondary" onClick={() => setDriverAttempt((n) => n + 1)}>
                <RotateCcw />
                {t("common.retry")}
              </button>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="stack-sm">{backLink}</div>

      {/* Header card */}
      <section className="card" style={{ padding: 22, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        {driver?.picture_url ? (
          <span className="av-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={driver.picture_url} alt="" className="av xl" style={{ objectFit: "cover" }} />
            <i className="st" style={{ background: `var(--${presence === "online" ? "success" : presence === "offline" ? "neutral" : presence === "en_route" ? "warning" : "info"}-dot)` }} />
          </span>
        ) : (
          <Av name={driver?.name ?? "?"} size="xl" presence={presence} />
        )}
        <div className="stack-sm grow" style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, letterSpacing: "-.025em" }}>{driver?.name ?? "…"}</h1>
          {status && (
            <div className="row-wrap" style={{ gap: 8 }}>
              <span className={`badge ${driver?.active ? "success" : ""}`}>
                <span className="dot" />
                {driver?.active ? d("active") : d("inactive")}
              </span>
              <span className="subtle">·</span>
              <span className="strong text-sm" style={{ color: status.color }}>{status.text}</span>
            </div>
          )}
          {driver?.phone && (
            <div className="muted num" dir="ltr" style={{ textAlign: "start" }}>
              {driver.phone}
            </div>
          )}
        </div>
      </section>

      <div className="stack">
        <div className="tabs" role="tablist">
          {([
            { k: "performance", label: d("tabPerformance") },
            { k: "details", label: d("tabDetails") },
          ] as const).map(({ k, label }) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "performance" ? (
          <div className="stack">
            <div className="stack-sm">
              <div className="row between">
                <h2 className="section-title">{d("performanceData")}</h2>
                <div className="seg" role="group" aria-label={d("performanceData")}>
                  {([
                    { k: "today", label: d("today") },
                    { k: "yesterday", label: d("yesterday") },
                    { k: "7", label: `7${d("daysShort")}` },
                    { k: "30", label: `30${d("daysShort")}` },
                    { k: "custom", label: d("customRange") },
                  ] as const).map(({ k, label }) => (
                    <button key={k} type="button" className={range === k ? "on" : ""} onClick={() => setRange(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {range === "custom" && (
                <div className="range-strip">
                  <div className="field">
                    <label htmlFor="rs-from">{d("from")}</label>
                    <input id="rs-from" type="date" className="input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="rs-to">{d("to")}</label>
                    <input id="rs-to" type="date" className="input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {/* This driver's own offers for the window */}
            {!driver?.uber_driver_uuid ? (
              <section className="card">
                <div className="card-body">
                  <p className="muted">{d("notLinkedNoMetrics")}</p>
                </div>
              </section>
            ) : (
              <section className="card table-card">
                {loadingOffers ? (
                  <SkelRows rows={4} cols={4} />
                ) : offers.length === 0 ? (
                  <EmptyState icon={Inbox} title={d("offersTitle")} description={d("noOffers")} />
                ) : (
                  <>
                    <div className="table-wrap ofr-tbl">
                      <table className="tbl compact">
                        <thead>
                          <tr>
                            <th>{o("colTime")}</th>
                            <th>{o("colRoute")}</th>
                            <th className="r">{o("colFare")}</th>
                            <th>{o("colStatus")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupedByDay.map(([key, dayOffers]) => {
                            const open = openDays.has(key);
                            return [
                              <tr key={`h-${key}`} className="day-row">
                                <td colSpan={4}>
                                  <button type="button" className="day-toggle" aria-expanded={open} onClick={() => toggleDay(key)}>
                                    <ChevronDown />
                                    <span>{dayLabel(key)}</span>
                                    <span className="day-pill">
                                      {/* The oldest loaded day may continue on the next page. */}
                                      {hasMoreOffers && key === groupedByDay[groupedByDay.length - 1][0] ? "≥ " : ""}
                                      {dayOffers.length} {o("offersCount")}
                                    </span>
                                  </button>
                                </td>
                              </tr>,
                              ...(open
                                ? dayOffers.map((offer) => (
                                    <tr key={offer.id} className="clickable" onClick={() => setDetailId(offer.id)}>
                                      <td>
                                        <button
                                          type="button"
                                          className="time-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDetailId(offer.id);
                                          }}
                                        >
                                          {offer.received_at ? new Date(offer.received_at).toLocaleTimeString(latnLocale(locale)) : "—"}
                                        </button>
                                      </td>
                                      <td>
                                        <div style={{ minWidth: 240, maxWidth: 400 }}>
                                          <div className="route">
                                            <span className="dotA" />
                                            <div className="truncate">{offer.pickup_address ?? "—"}</div>
                                            <span className="via" />
                                            <span />
                                            <span className="dotB" />
                                            <div className="truncate">
                                              {offer.dropoff_address ?? "—"}
                                              {offer.stops_count != null && offer.stops_count >= 2 && (
                                                <>
                                                  {" "}
                                                  <span className="badge warning square" style={{ height: 18, padding: "0 5px" }}>+{offer.stops_count - 1}</span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="r">
                                        <span className="num strong nowrap">{toLatinDigits(fareLabel(offer, latnLocale(locale)))}</span>
                                      </td>
                                      <td>
                                        <OfferStatusBadge offer={offer} />
                                      </td>
                                    </tr>
                                  ))
                                : []),
                            ];
                          })}
                        </tbody>
                      </table>
                    </div>
                    {offersMeta && offersMeta.total > offers.length && (
                      <div className="tbl-foot">
                        <span>
                          {t("common.showingOf")
                            .replace("{shown}", formatNumber(offers.length, locale))
                            .replace("{total}", formatNumber(offersMeta.total, locale))}
                        </span>
                        {hasMoreOffers && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={loadMoreOffers} disabled={loadingMore}>
                            {loadingMore ? t("common.loading") : t("common.loadMore")}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {/* Uber's official earnings — captured from the Fleet Earnings page */}
            {uber && (
              <section className="card">
                <div className="card-head">
                  <div className="truncate">
                    <h2 className="row" style={{ gap: 8 }}>
                      <span className="subtle">
                        <BadgeCheck style={{ width: 18, height: 18 }} />
                      </span>
                      {d("uberData")}
                    </h2>
                    <div className="sub">{d("uberDataHint")}</div>
                  </div>
                  <span className="subtle text-sm num" dir="ltr">{uberPeriod(uber, latnLocale(locale))}</span>
                </div>
                <div className="card-body stack">
                  <div className="mstat-grid">
                    <MiniStat label={d("statEarnings")} value={money(uber.earnings, uber.earnings_label)} />
                    <MiniStat label={d("statTrips")} value={uber.trips != null ? String(uber.trips) : "—"} />
                    <MiniStat label={d("statKm")} value={uber.distance_km != null ? `${uber.distance_km} km` : "—"} />
                    <MiniStat label={d("statNet")} value={money(uber.net_outstanding, uber.earnings_label)} />
                    {uber.breakdown?.promotion != null && (
                      <MiniStat label={d("statPromo")} value={money(uber.breakdown.promotion, uber.earnings_label)} />
                    )}
                    {uber.breakdown?.tip != null && <MiniStat label={d("statTip")} value={money(uber.breakdown.tip, uber.earnings_label)} />}
                  </div>

                  {/* Cash vs cashless — the cash the driver collected by hand vs what settles to the fleet through Uber. */}
                  <div className="g-2">
                    <div className="mstat" style={{ background: "var(--warning-bg)", borderColor: "transparent" }}>
                      <span className="l" style={{ color: "var(--warning-fg)" }}>{d("statCash")}</span>
                      <span className="v" dir="ltr">{money(Math.abs(uber.breakdown?.cash_collected ?? 0), uber.earnings_label)}</span>
                      <span className="h">{d("statCashHint")}</span>
                    </div>
                    <div className="mstat" style={{ background: "var(--success-bg)", borderColor: "transparent" }}>
                      <span className="l" style={{ color: "var(--success-fg)" }}>{d("statCashless")}</span>
                      <span className="v" dir="ltr">{money(uber.net_outstanding, uber.earnings_label)}</span>
                      <span className="h">{d("statCashlessHint")}</span>
                    </div>
                  </div>

                  {uber.breakdown && Object.keys(uber.breakdown).length > 0 && (
                    <div>
                      <h3 className="section-title" style={{ marginBottom: 10 }}>{d("breakdown")}</h3>
                      <dl className="kv" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                        {Object.entries(uber.breakdown).map(([cat, amt]) => (
                          <div key={cat}>
                            <dt style={{ fontSize: 12 }}>{prettyCat(cat, t)}</dt>
                            <dd className="num" dir="ltr">{money(amt, uber.earnings_label)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* No Uber earnings captured yet — tell the manager how to populate it. */}
            {!uber && (
              <section className="card">
                <div className="card-head">
                  <h2 className="row" style={{ gap: 8 }}>
                    <span className="subtle">
                      <BadgeCheck style={{ width: 18, height: 18 }} />
                    </span>
                    {d("uberData")}
                  </h2>
                </div>
                <div className="card-body">
                  <p className="muted">{d("metricsUnavailable")}</p>
                </div>
              </section>
            )}

            {/* Uber-sourced performance metrics (server-synced) */}
            {uber && hasUberPerformance(uber) && (
              <section className="card">
                <div className="card-head">
                  <div className="truncate">
                    <h2>{t("screens.driverUber.title")}</h2>
                    <div className="sub">{t("screens.driverUber.hint")}</div>
                  </div>
                </div>
                <div className="card-body">
                  <div className="mstat-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                    <MiniStat label={t("screens.driverUber.hoursOnline")} value={hoursLabel(uber.hours_online, locale)} />
                    <MiniStat label={t("screens.driverUber.hoursOnTrip")} value={hoursLabel(uber.hours_on_trip, locale)} />
                    <MiniStat label={t("screens.driverUber.acceptance")} value={pctLabel(uber.acceptance_rate, locale)} />
                    <MiniStat label={t("screens.driverUber.cancellation")} value={pctLabel(uber.cancellation_rate, locale)} />
                  </div>
                </div>
              </section>
            )}

            {/* Our own captured data */}
            {stats && (
              <section className="card">
                <div className="card-head">
                  <div className="truncate">
                    <h2 className="row" style={{ gap: 8 }}>
                      <span className="subtle">
                        <Database style={{ width: 18, height: 18 }} />
                      </span>
                      {d("ourData")}
                    </h2>
                    <div className="sub">{d("ourDataHint")}</div>
                  </div>
                </div>
                <div className="card-body">
                  <div className="mstat-grid">
                    <MiniStat label={d("statEarnings")} value={formatMoney(stats.earnings, locale)} />
                    <MiniStat label={d("statTrips")} value={formatNumber(stats.trips, locale)} />
                    <MiniStat label={d("statAccept")} value={`${stats.acceptance_rate}%`} />
                    <MiniStat label={d("statOffers")} value={formatNumber(stats.offers, locale)} />
                    <MiniStat label={d("statAccepted")} value={formatNumber(stats.accepted, locale)} />
                    <MiniStat label={d("statKm")} value={`${stats.km} km`} />
                  </div>
                </div>
              </section>
            )}
          </div>
        ) : (
          /* Details tab */
          <section className="card">
            <div className="card-body">
              <div className="g-2">
                <InfoTile icon={Star} label={d("colRating")} tone="warning">
                  {driver?.rating != null ? <span className="num">{driver.rating.toFixed(2)}</span> : "—"}
                </InfoTile>
                <InfoTile icon={Car} label={d("colTrips")}>
                  <span className="num">{driver?.total_trips != null ? formatNumber(driver.total_trips, locale) : "—"}</span>
                </InfoTile>
                <InfoTile icon={Phone} label={d("colPhone")} tone="info">
                  {driver?.phone ? <span className="num" dir="ltr">{driver.phone}</span> : "—"}
                </InfoTile>
                <InfoTile icon={Mail} label={d("email")}>
                  {driver?.uber_email ? <span dir="ltr">{driver.uber_email}</span> : "—"}
                </InfoTile>
                <InfoTile icon={Link2} label={d("linkMethod")} tone="success">
                  {driver?.uber_link_method ? d(`linkMethod_${driver.uber_link_method}`) : "—"}
                </InfoTile>
              </div>
            </div>
          </section>
        )}
      </div>

      {detailId !== null && <OfferDetailModal id={detailId} onClose={closeDetail} />}
    </>
  );
}

function InfoTile({
  icon: Icon,
  label,
  tone = "",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "" | "warning" | "info" | "success";
  children: React.ReactNode;
}) {
  return (
    <div className="info-tile">
      <span className={`stat-ico ${tone}`} style={{ width: 36, height: 36, borderRadius: 10 }}>
        <Icon />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="k">{label}</div>
        <div className="v">{children}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mstat">
      <span className="l">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}
