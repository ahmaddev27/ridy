"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Phone, Mail, Star, Car, UserCheck, MapPin, ArrowRight, ChevronDown, Inbox, Banknote, CreditCard } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import { getDriver, getDriverStats, getDriverMetrics, type Driver, type DriverStats, type DriverMetric } from "@/lib/api/drivers";
import { listOffersPaged, fareLabel, type DispatchOffer, type OfferStatus } from "@/lib/api/offers";
import { OfferDetailModal } from "../../offers/offer-detail-modal";

type RangeKey = "today" | "yesterday" | "7" | "30" | "custom";

/** Offer lifecycle status → badge tone (mirrors the offers page). */
const OFFER_TONE: Record<OfferStatus, Status> = {
  pending: "expiring",
  accepted: "info",
  started: "private",
  completed: "connected",
  rejected: "neutral",
  canceled: "personal",
};

// Uber measures a "day" as its business day: 04:00 → 04:00 in the fleet's
// timezone (Europe/Berlin), NOT local midnight. Aligning our windows to the same
// boundary is what makes the Uber performance cards match the Uber app exactly.
const FLEET_TZ = "Europe/Berlin";
const BIZ_START_HOUR = 4;
const DAY_MS = 86_400_000;

/** UTC ms for a given Berlin wall-clock time (handles the tz offset + DST). */
function berlinWallMs(y: number, m: number, d: number, h: number): number {
  const guess = Date.UTC(y, m - 1, d, h);
  const asUtc = Date.parse(
    new Date(guess).toLocaleString("sv-SE", { timeZone: FLEET_TZ }).replace(" ", "T") + "Z",
  );
  return guess - (asUtc - guess); // guess minus the Berlin offset at that instant
}

/** Start (ms) of the current Uber business day: the most recent 04:00 Berlin. */
function businessDayStartMs(): number {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: FLEET_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const start = berlinWallMs(g("year"), g("month"), g("day"), BIZ_START_HOUR);
  // Before 04:00 Berlin we're still inside yesterday's business day.
  return Date.now() >= start ? start : start - DAY_MS;
}

/** Business-day window [from,to) in ms for the selected range (Uber-aligned). */
function rangeMs(key: RangeKey): { from: number; to: number } {
  const now = Date.now();
  const bizStart = businessDayStartMs();
  if (key === "today") return { from: bizStart, to: now };
  if (key === "yesterday") return { from: bizStart - DAY_MS, to: bizStart };
  return { from: now - Number(key) * DAY_MS, to: now };
}

/** Currency amount with its symbol ("€1,481.04"), or "—" when absent. */
function money(amount: number | string | null | undefined, label: string | null): string {
  if (amount == null) return "—";
  // Laravel serializes decimal casts as strings (e.g. "62595.12"), so coerce
  // before formatting — amount.toFixed on a string throws.
  const n = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(n)) return "—";
  const symbol = label === "EUR" ? "€" : label ? `${label} ` : "";
  return `${symbol}${n.toFixed(2)}`;
}

/** "cash_collected" → "Cash collected" for a breakdown category label. */
function prettyCat(cat: string): string {
  const s = cat.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "12 Aug – 19 Aug" for a captured earnings window. */
function uberPeriod(m: DriverMetric, loc: string): string {
  const fmt = (s: string) => new Date(s).toLocaleDateString(loc, { day: "numeric", month: "short" });
  return `${fmt(m.period_start)} – ${fmt(m.period_end)}`;
}

function statusLabel(driver: Driver, d: (k: string) => string): { text: string; tone: string } {
  const s = (driver.online_status ?? "").toUpperCase();
  if (s.includes("ON_TRIP")) return { text: d("onTrip"), tone: "text-success-fg" };
  if (s.includes("EN_ROUTE")) return { text: d("enRoute"), tone: "text-warning-fg" };
  if (driver.online) return { text: d("online"), tone: "text-success-fg" };
  return { text: d("offline"), tone: "text-ink-subtle" };
}

export default function DriverProfilePage() {
  const { t, locale } = useI18n();
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
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  // Stable identity so the modal's fetch effect doesn't re-run every render.
  const closeDetail = useCallback(() => setDetailId(null), []);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([new Date().toDateString()]));

  useEffect(() => {
    getDriver(id).then(setDriver).catch(() => setDriver(null));
  }, [id]);

  // The active window (ms for Uber metrics, Y-M-D for our stats), from a preset
  // or a custom from→to range.
  const win = useMemo(() => {
    if (range === "custom") {
      const fromMs = customFrom ? new Date(customFrom).getTime() : Date.now() - 7 * 86_400_000;
      const toMs = customTo ? new Date(customTo).getTime() + 86_400_000 : Date.now(); // include the "to" day
      return { fromMs, toMs, fromDate: customFrom || undefined, toDate: customTo || undefined };
    }
    const { from, to } = rangeMs(range);
    return { fromMs: from, toMs: to, fromDate: new Date(from).toISOString().slice(0, 10), toDate: new Date(to).toISOString().slice(0, 10) };
  }, [range, customFrom, customTo]);

  // Our own stats respect the same window.
  useEffect(() => {
    getDriverStats(id, win.fromDate, win.toDate).then(setStats).catch(() => setStats(null));
  }, [id, win.fromDate, win.toDate]);

  // Uber's OFFICIAL earnings (captured from the Fleet Earnings page). We show the
  // most recent captured window, regardless of the selected preset, since Uber's
  // period is whatever the manager last viewed on Uber.
  useEffect(() => {
    getDriverMetrics(id).then((m) => setUber(m[0] ?? null)).catch(() => setUber(null));
  }, [id]);

  // On open, ask the extension to refresh this driver's Uber earnings on demand
  // (replays getEarnerBreakdownsV2 → backend), so earnings are current without the
  // manager reopening the Uber tab.
  useEffect(() => {
    const uuid = driver?.uber_driver_uuid;
    if (!uuid) return;
    function onDone(e: MessageEvent) {
      if (e.source !== window || (e.data as { source?: string })?.source !== "ridy-driver-uber-done") return;
      const d = e.data as { breakdown?: boolean };
      if (d.breakdown) getDriverMetrics(id).then((m) => setUber(m[0] ?? null)).catch(() => {});
    }
    window.addEventListener("message", onDone);
    window.postMessage({ source: "ridy-fetch-driver-uber", driverUuid: uuid }, "*");
    return () => window.removeEventListener("message", onDone);
  }, [driver?.uber_driver_uuid, id]);

  // This driver's own captured offers for the selected window.
  useEffect(() => {
    const uuid = driver?.uber_driver_uuid;
    if (!uuid) {
      setOffers([]);
      return;
    }
    setLoadingOffers(true);
    listOffersPaged({ driverUuid: uuid, from: win.fromDate, to: win.toDate, perPage: 100 })
      .then((res) => setOffers(res.items))
      .catch(() => setOffers([]))
      .finally(() => setLoadingOffers(false));
  }, [driver?.uber_driver_uuid, win.fromDate, win.toDate]);

  // Group the loaded offers into day buckets (feed is newest-first).
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, DispatchOffer[]>();
    for (const offer of offers) {
      const key = offer.received_at ? new Date(offer.received_at).toDateString() : "—";
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
    if (key === new Date().toDateString()) return o("today");
    if (key === "—") return "—";
    return new Date(key).toLocaleDateString(latnLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  }

  const status = driver ? statusLabel(driver, d) : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link href="/drivers" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {d("backToDrivers")}
      </Link>

      {/* Header — grounded in a card */}
      <Card className="flex items-center gap-4 p-5">
        {driver?.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={driver.picture_url} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-white shadow" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-2 text-2xl font-semibold text-ink">
            {driver?.name?.slice(0, 1) ?? "?"}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-ink">{driver?.name ?? "…"}</h1>
          {status && (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success-fg">
                {driver?.active ? d("active") : d("inactive")}
              </span>
              <span className="text-ink-subtle">·</span>
              <span className={`font-medium ${status.tone}`}>{status.text}</span>
            </div>
          )}
          {driver?.phone && <p className="mt-1 text-sm text-ink-subtle" dir="ltr">{driver.phone}</p>}
        </div>
      </Card>

      {/* Tabs (Uber-style underline) */}
      <div className="flex gap-6 border-b border-line">
        {([
          { k: "performance", label: d("tabPerformance") },
          { k: "details", label: d("tabDetails") },
        ] as const).map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              "-mb-px border-b-2 px-1 pb-3 text-sm font-semibold transition-colors " +
              (tab === k ? "border-ink text-ink" : "border-transparent text-ink-subtle hover:text-ink-muted")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "performance" ? (
        <div className="space-y-5">
          {/* Range toggle */}
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-ink">{d("performanceData")}</h3>
            <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1 text-sm">
              {([
                { k: "today", label: d("today") },
                { k: "yesterday", label: d("yesterday") },
                { k: "7", label: `7${d("daysShort")}` },
                { k: "30", label: `30${d("daysShort")}` },
                { k: "custom", label: d("customRange") },
              ] as const).map(({ k, label }) => (
                <button
                  key={k}
                  onClick={() => setRange(k)}
                  className={"rounded-lg px-3 py-1.5 font-medium transition-colors " + (range === k ? "bg-primary text-primary-ink" : "text-ink-muted hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom from → to */}
          {range === "custom" && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-ink-muted">{d("from")}</span>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-ink-muted">{d("to")}</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink" />
              </label>
            </div>
          )}

          {/* This driver's own offers for the window */}
          {!driver?.uber_driver_uuid ? (
            <Card className="p-6 text-center text-sm text-ink-subtle">{d("notLinkedNoMetrics")}</Card>
          ) : (
            <Card className="overflow-hidden">
              {loadingOffers ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
                  ))}
                </div>
              ) : offers.length === 0 ? (
                <EmptyState icon={Inbox} title={d("offersTitle")} description={d("noOffers")} />
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
                            {dayOffers.length} {o("offersCount")}
                          </span>
                        </button>
                        {open && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <tbody className="divide-y divide-line">
                                {dayOffers.map((offer) => (
                                  <tr
                                    key={offer.id}
                                    onClick={() => setDetailId(offer.id)}
                                    className="cursor-pointer hover:bg-surface-2"
                                  >
                                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                                      {offer.received_at ? new Date(offer.received_at).toLocaleTimeString(latnLocale(locale)) : "—"}
                                    </td>
                                    <td className="px-4 py-3 text-ink-muted">
                                      <div className="flex items-start gap-1.5">
                                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-fg" />
                                        <div className="min-w-0">
                                          <div className="truncate">{offer.pickup_address ?? "—"}</div>
                                          <div className="flex items-center gap-1 truncate text-ink-subtle">
                                            <ArrowRight className="h-3 w-3 shrink-0 rtl:rotate-180" />
                                            <span className="truncate">{offer.dropoff_address ?? "—"}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">
                                      {toLatinDigits(fareLabel(offer, latnLocale(locale)))}
                                    </td>
                                    <td className="px-4 py-3">
                                      {(() => {
                                        const st = offer.status ?? (offer.accepted ? "accepted" : "pending");
                                        return <Badge status={OFFER_TONE[st]} dot>{o(`st_${st}`)}</Badge>;
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
            </Card>
          )}

          {/* Uber's official earnings — captured from the Fleet Earnings page */}
          {uber && (
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">{d("uberData")}</h4>
                <span className="text-xs text-ink-subtle" dir="ltr">{uberPeriod(uber, latnLocale(locale))}</span>
              </div>
              <p className="mb-3 mt-0.5 text-xs text-ink-subtle">{d("uberDataHint")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <MiniStat label={d("statEarnings")} value={money(uber.earnings, uber.earnings_label)} />
                <MiniStat label={d("statTrips")} value={uber.trips != null ? String(uber.trips) : "—"} />
                <MiniStat label={d("statKm")} value={uber.distance_km != null ? `${uber.distance_km} km` : "—"} />
                <MiniStat label={d("statNet")} value={money(uber.net_outstanding, uber.earnings_label)} />
                {uber.breakdown?.promotion != null && (
                  <MiniStat label={d("statPromo")} value={money(uber.breakdown.promotion, uber.earnings_label)} />
                )}
                {uber.breakdown?.tip != null && (
                  <MiniStat label={d("statTip")} value={money(uber.breakdown.tip, uber.earnings_label)} />
                )}
              </div>

              {/* Cash vs cashless — the cash the driver collected by hand (owed to
                  the fleet) vs the amount that settles to the fleet through Uber. */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
                    <Banknote className="h-3.5 w-3.5" /> {d("statCash")}
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-amber-600" dir="ltr">
                    {money(Math.abs(uber.breakdown?.cash_collected ?? 0), uber.earnings_label)}
                  </div>
                  <div className="text-[11px] text-ink-subtle">{d("statCashHint")}</div>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
                    <CreditCard className="h-3.5 w-3.5" /> {d("statCashless")}
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-emerald-600" dir="ltr">
                    {money(uber.net_outstanding, uber.earnings_label)}
                  </div>
                  <div className="text-[11px] text-ink-subtle">{d("statCashlessHint")}</div>
                </div>
              </div>

              {uber.breakdown && Object.keys(uber.breakdown).length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-xs font-medium text-ink-subtle">{d("breakdown")}</p>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(uber.breakdown).map(([cat, amt]) => (
                      <div key={cat} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-ink-muted">{prettyCat(cat)}</span>
                        <span className="font-medium tabular-nums text-ink" dir="ltr">{money(amt, uber.earnings_label)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* No Uber earnings captured yet for this driver — tell the manager how
              to populate it (incl. the cash / cashless split) instead of hiding it. */}
          {!uber && (
            <Card className="p-5">
              <h4 className="text-sm font-semibold text-ink">{d("uberData")}</h4>
              <p className="mt-2 text-sm text-ink-subtle">{d("metricsUnavailable")}</p>
            </Card>
          )}

          {/* Our own captured data */}
          {stats && (
            <Card className="p-5">
              <h4 className="text-sm font-semibold text-ink">{d("ourData")}</h4>
              <p className="mb-3 mt-0.5 text-xs text-ink-subtle">{d("ourDataHint")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <MiniStat label={d("statEarnings")} value={`€${stats.earnings.toFixed(2)}`} />
                <MiniStat label={d("statTrips")} value={String(stats.trips)} />
                <MiniStat label={d("statAccept")} value={`${stats.acceptance_rate}%`} />
                <MiniStat label={d("statOffers")} value={String(stats.offers)} />
                <MiniStat label={d("statAccepted")} value={String(stats.accepted)} />
                <MiniStat label={d("statKm")} value={`${stats.km} km`} />
              </div>
            </Card>
          )}
        </div>
      ) : (
        /* Details tab */
        <Card className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoTile icon={Star} label={d("colRating")} tone="amber">
              {driver?.rating != null ? (
                <span className="inline-flex items-center gap-1">
                  {driver.rating.toFixed(2)}
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                </span>
              ) : "—"}
            </InfoTile>
            <InfoTile icon={Car} label={d("colTrips")}>{driver?.total_trips != null ? driver.total_trips.toLocaleString() : "—"}</InfoTile>
            <InfoTile icon={Phone} label={d("colPhone")}>{driver?.phone ? <span dir="ltr">{driver.phone}</span> : "—"}</InfoTile>
            <InfoTile icon={Mail} label={d("email")}>{driver?.uber_email ? <span dir="ltr">{driver.uber_email}</span> : "—"}</InfoTile>
            <InfoTile icon={UserCheck} label={d("linkMethod")}>
              {driver?.uber_link_method ? d(`linkMethod_${driver.uber_link_method}`) : "—"}
            </InfoTile>
          </div>
        </Card>
      )}

      {detailId !== null && (
        <OfferDetailModal id={detailId} onClose={closeDetail} />
      )}
    </div>
  );
}

function InfoTile({
  icon: Icon,
  label,
  tone = "default",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "default" | "amber";
  children: React.ReactNode;
}) {
  const chip = tone === "amber" ? "bg-warning-bg text-warning-fg" : "bg-surface-2 text-ink-muted";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${chip}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
        <div className="truncate text-sm font-semibold text-ink">{children}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
