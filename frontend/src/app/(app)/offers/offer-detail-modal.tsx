"use client";

import { useEffect, useState } from "react";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import dynamic from "next/dynamic";
import { X, MapPin, Flag, User, CircleDollarSign, Clock, Loader2, Route, Gauge, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import { getOffer, fareLabel, type DispatchOfferDetail, type OfferStatus } from "@/lib/api/offers";

/** Offer lifecycle status → badge tone (mirrors the offers list). */
const OFFER_TONE: Record<OfferStatus, Status> = {
  pending: "expiring",
  accepted: "info",
  started: "private",
  completed: "connected",
  rejected: "neutral",
  canceled: "personal",
};

// Leaflet touches `window`, so load the map client-side only.
const TripMap = dynamic(() => import("./trip-map").then((m) => m.TripMap), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-xl bg-surface-2" />,
});

/**
 * Full detail for one dispatch offer. Renders the known fields, every stop found
 * in the raw payload (multi-stop trips), and a collapsible raw-JSON view so no
 * captured detail is hidden. RTL-safe via logical classes.
 */
export function OfferDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.offers.${k}`);
  const [offer, setOffer] = useState<DispatchOfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    getOffer(id)
      .then(setOffer)
      .catch((e) => setError(e instanceof Error ? e.message : "error"));
    return () => document.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  const stops = extractStops(offer?.raw);

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface text-start shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">
              {offer?.rider_first_name || c("colRider") || "—"}
            </h2>
            <p className="mt-0.5 text-sm text-ink-subtle">{offer?.driver_name ?? "—"}</p>
          </div>
          <div className="flex items-center gap-2">
            {offer && (() => {
              const st = offer.status ?? (offer.accepted ? "accepted" : "pending");
              return <Badge status={OFFER_TONE[st]} dot>{c(`st_${st}`)}</Badge>;
            })()}
            {(offer?.fare_amount != null || offer?.fare_formatted) && (
              <span className="rounded-lg bg-success-bg px-2.5 py-1 text-sm font-semibold text-success-fg">
                {toLatinDigits(fareLabel(offer, latnLocale(locale)))}
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-2 hover:text-ink-muted"
              aria-label={c("close") || "Close"}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="p-6 text-sm text-danger-fg">{error}</div>
          ) : !offer ? (
            <div className="flex items-center justify-center p-10 text-ink-subtle">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Route with every stop */}
              <div className="border-b border-line p-5">
                <ol className="space-y-3">
                  {stops.map((s, i) => {
                    const isLast = i === stops.length - 1;
                    return (
                      <li key={i} className="flex items-start gap-3">
                        {isLast ? (
                          <Flag className="mt-0.5 h-4 w-4 shrink-0 text-danger-fg" />
                        ) : (
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" />
                        )}
                        <span className="text-sm text-ink">{s}</span>
                      </li>
                    );
                  })}
                </ol>
                {stops.length > 2 && (
                  <p className="mt-3 text-xs font-medium text-ink">
                    {stops.length} {c("stops") || "stops"}
                  </p>
                )}
              </div>

              {/* Trip map + distance / price-per-km */}
              {offer.trip && (offer.trip.pickup || offer.trip.dropoff) && (
                <div className="space-y-3 border-b border-line p-5">
                  <TripMap
                    pickup={offer.trip.pickup}
                    dropoff={offer.trip.dropoff}
                    routeGeometry={offer.trip.route_geometry}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <StatCard
                      icon={Route}
                      label={c("distance")}
                      value={offer.trip.distance_km != null ? `${offer.trip.distance_km} km` : "—"}
                    />
                    <StatCard
                      icon={Gauge}
                      label={c("pricePerKm")}
                      value={pricePerKm(offer) != null ? `${pricePerKm(offer)!.toFixed(2)} €/km` : "—"}
                    />
                    <StatCard icon={Wallet} label={c("colFare")} value={toLatinDigits(fareLabel(offer, latnLocale(locale)))} />
                  </div>
                </div>
              )}

              {/* Known fields */}
              <dl className="divide-y divide-line">
                <Row icon={User} label={c("colDriver")}>{offer.driver_name ?? "—"}</Row>
                <Row icon={CircleDollarSign} label={c("colFare")}>{toLatinDigits(fareLabel(offer, latnLocale(locale)))}</Row>
                <Row icon={Clock} label={c("colTime")}>
                  {offer.received_at ? new Date(offer.received_at).toLocaleString(latnLocale(locale)) : "—"}
                </Row>
                {offer.trip_duration_seconds != null && (
                  <Row icon={Clock} label={c("colDuration")}>
                    {toLatinDigits(`${Math.round(offer.trip_duration_seconds / 60)} min`)}
                  </Row>
                )}
              </dl>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="flex items-center gap-2 text-sm text-ink-muted">
        <Icon className="h-4 w-4 text-ink-subtle" />
        {label}
      </dt>
      <dd className="min-w-0 truncate text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

/**
 * Pull an ordered list of stop addresses from the raw offer. Uber puts extra
 * waypoints in arrays that vary by offer type, so we look through common keys
 * and fall back to the flat pickup/dropoff fields.
 */
/** Parse a formatted fare ("4,78 €" / "$4.78") into a number, handling German commas. */
function parseFareNum(s: string | null | undefined): number | null {
  if (!s) return null;
  let n = s.replace(/[^0-9.,]/g, "");
  if (n.includes(",") && n.includes(".")) n = n.lastIndexOf(",") > n.lastIndexOf(".") ? n.replace(/\./g, "") : n.replace(/,/g, "");
  n = n.replace(",", ".");
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : null;
}

/** Price per km — prefer the backend value; else compute from any known fare + distance. */
function pricePerKm(offer: DispatchOfferDetail): number | null {
  const trip = offer.trip;
  if (!trip || !trip.distance_km) return null;
  if (trip.price_per_km != null) return trip.price_per_km;
  // Fall back to any known numeric fare (trip or the offer's authoritative
  // column) before parsing the formatted string.
  const fare = trip.fare_amount ?? offer.fare_amount ?? parseFareNum(offer.fare_formatted);
  return fare != null ? fare / trip.distance_km : null;
}

function extractStops(raw: Record<string, unknown> | null | undefined): string[] {
  if (!raw) return [];
  const arrayKeys = ["waypoints", "wayPoints", "stops", "legs", "route"];
  for (const key of arrayKeys) {
    const arr = raw[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const addrs = arr
        .map((w) => addressOf(w))
        .filter((a): a is string => Boolean(a));
      if (addrs.length > 0) return addrs;
    }
  }
  // Fallback: the flat pickup -> dropoff pair.
  const flat = [raw.pickupAddress, raw.dropoffAddress].filter(
    (a): a is string => typeof a === "string" && a.length > 0,
  );
  return flat;
}

function addressOf(node: unknown): string | null {
  if (typeof node === "string") return node;
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const k of ["address", "formattedAddress", "fullAddress", "title", "name"]) {
      if (typeof o[k] === "string" && (o[k] as string).length > 0) return o[k] as string;
    }
  }
  return null;
}
