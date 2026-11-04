"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useDialogFocus } from "@/components/ui/modal";
import { useRouter } from "next/navigation";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import dynamic from "next/dynamic";
import { X, MapPin, User, Clock, Timer, Loader2, Route, Wallet } from "lucide-react";
import { StatTile } from "@/components/ui/rd";
import { OfferStatusBadge } from "@/components/ui/offer-status-badge";
import { useI18n } from "@/lib/i18n/context";
import { getOffer, fareLabel, type DispatchOfferDetail } from "@/lib/api/offers";

/** One row in the modal's stop list: an address with its per-leg + cumulative km. */
type StopRow = { address: string; legKm: number | null; cumulativeKm: number | null };

// MapLibre GL touches `window`, so load the map client-side only.
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
  const router = useRouter();
  const [offer, setOffer] = useState<DispatchOfferDetail | null>(null);

  // Jump to the matched driver's profile (closes this modal first).
  const openDriver = () => {
    if (offer?.driver_id == null) return;
    onClose();
    router.push(`/drivers/${offer.driver_id}`);
  };
  const [error, setError] = useState<string | null>(null);

  // Fetch depends ONLY on id: onClose is a fresh inline function each parent
  // render, so keeping it in the deps re-ran this and re-fetched the offer every
  // few seconds. The Escape handler lives in its own effect keyed on onClose.
  useEffect(() => {
    getOffer(id)
      .then(setOffer)
      .catch((e) => setError(e instanceof Error ? e.message : "error"));
  }, [id]);

  // Escape to close, focus moved in / trapped / restored to the opener.
  const dialogRef = useDialogFocus(true, onClose);
  const dialogTitleId = useId();

  // The stop list shown in the modal. Prefer the trip's corrected pickup/drop-off
  // (they carry the completed postcode / the address reverse-geocoded from Uber's
  // real coordinates — the same text the offers row shows), and only fall back to
  // the raw payload for a genuine multi-stop trip's intermediate stops. This keeps
  // the modal in sync with the row instead of showing the raw, uncorrected text.
  // The ordered stop rows shown in the modal: each an address plus the road
  // distance from the previous stop (legKm) and the running total (cumulativeKm).
  const stops = useMemo<StopRow[]>(() => {
    const pickup = tidyAddr(offer?.trip?.pickup_address ?? "");
    const dropoff = tidyAddr(offer?.trip?.dropoff_address ?? "");

    // Prefer Uber's authoritative live-map stops (each reverse-geocoded to an
    // address + given a per-leg road distance on the backend) — the only source
    // that names a multi-stop trip's INTERMEDIATE drop-offs and their distances.
    const tripStops = offer?.trip?.stops;
    if (tripStops && tripStops.length > 2) {
      return tripStops
        .map((s, i) => ({
          address:
            i === 0 ? pickup || tidyAddr(s.address ?? "")
              : i === tripStops.length - 1 ? dropoff || tidyAddr(s.address ?? "")
              : tidyAddr(s.address ?? ""),
          legKm: s.leg_m != null ? s.leg_m / 1000 : null,
          cumulativeKm: s.cumulative_m != null ? s.cumulative_m / 1000 : null,
        }))
        .filter((r) => r.address);
    }

    // Single drop-off (or stops not yet resolved): corrected pickup + drop-off,
    // falling back to the raw offer text. The drop-off carries the trip distance.
    const raw = extractStops(offer?.raw).map(tidyAddr).filter(Boolean);
    const p = pickup || raw[0] || "";
    const d = dropoff || raw[raw.length - 1] || "";
    const total = offer?.trip?.distance_km ?? null;
    return [
      { address: p, legKm: null, cumulativeKm: null },
      { address: d, legKm: total, cumulativeKm: total },
    ].filter((r) => r.address);
  }, [offer?.raw, offer?.trip?.pickup_address, offer?.trip?.dropoff_address, offer?.trip?.stops, offer?.trip?.distance_km]);

  const perKm = offer ? pricePerKm(offer) : null;
  const fare = offer ? toLatinDigits(fareLabel(offer, latnLocale(locale))) : "";
  const hasFare = offer != null && (offer.fare_amount != null || !!offer.fare_formatted);
  const multi = offer?.trip?.stops_count != null && offer.trip.stops_count >= 2;

  const head = (
    <div className="modal-head">
      <div style={{ minWidth: 0 }}>
        <h2 id={dialogTitleId}>{offer?.rider_first_name || c("colRider") || "—"}</h2>
        <p>
          {offer?.driver_id != null ? (
            <button type="button" onClick={openDriver} className="link">
              {offer.driver_name ?? "—"}
            </button>
          ) : (
            (offer?.driver_name ?? "—")
          )}
        </p>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {offer && <OfferStatusBadge offer={offer} />}
        {hasFare && (
          <span className="badge success num" style={{ height: 26, fontSize: 13 }}>
            {fare}
          </span>
        )}
        <button type="button" className="icon-btn" onClick={onClose} aria-label={c("close") || "Close"}>
          <X />
        </button>
      </div>
    </div>
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} tabIndex={-1} className="modal lg outline-none">
        {head}
        {error ? (
          <div className="modal-body" style={{ color: "var(--danger-fg)" }}>{error}</div>
        ) : !offer ? (
          <div className="modal-body" style={{ alignItems: "center", color: "var(--ink-subtle)" }}>
            <Loader2 className="ico-sm" style={{ animation: "ofr-spin 1s linear infinite" }} />
          </div>
        ) : (
          <div className="modal-body stack">
            {/* Route with every stop */}
            <div className="stack-sm">
              <div className="row between">
                <h3 className="section-title">{c("routeTitle")}</h3>
                {multi ? (
                  <span className="badge warning">
                    <Route />
                    {c("multiStop") || "Multi-stop"} · {offer.trip!.stops_count} {c("dropoffs") || "drop-offs"}
                  </span>
                ) : stops.length > 2 ? (
                  <span className="subtle text-xs">
                    {stops.length} {c("stops") || "stops"}
                  </span>
                ) : null}
              </div>
              <ol className="timeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {stops.map((s, i) => {
                  const isPickup = i === 0;
                  return (
                    <li key={i} className="tl-item">
                      {/* Pickup keeps the green origin pin; drop-offs use the numbered blue marker. */}
                      <span className={`tl-dot ${isPickup ? "success" : "info"}`}>
                        {isPickup ? <MapPin /> : <span style={{ fontSize: 11, fontWeight: 700 }}>{i}</span>}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="strong" style={{ overflowWrap: "anywhere" }}>{s.address}</div>
                        <div className="subtle text-xs">
                          {isPickup ? c("stopPickup") : multi || stops.length > 2 ? `${c("stopDropoff")} ${i}` : c("stopDestination")}
                          {s.legKm != null && !isPickup && (
                            <span dir="ltr">
                              {" · "}
                              <span className="num">+{toLatinDigits(s.legKm.toFixed(1))} km</span>
                              {s.cumulativeKm != null && i > 1 && (
                                <span className="num"> · {toLatinDigits(s.cumulativeKm.toFixed(1))} km {c("total") || "total"}</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Trip map + distance / price-per-km */}
            {offer.trip && (offer.trip.pickup || offer.trip.dropoff) && (
              <>
                <TripMap
                  pickup={offer.trip.pickup}
                  dropoff={offer.trip.dropoff}
                  routeGeometry={offer.trip.route_geometry}
                  stops={offer.trip.stops}
                />
                <div className="g-3">
                  <StatTile label={c("distance")} value={offer.trip.distance_km != null ? `${offer.trip.distance_km} km` : "—"} />
                  <StatTile label={c("pricePerKm")} value={perKm != null ? `${perKm.toFixed(2)} €/km` : "—"} />
                  <StatTile label={c("colFare")} value={fare} />
                </div>
              </>
            )}

            {/* Known fields */}
            <div className="list-rows" style={{ padding: "0 2px" }}>
              <KvRow icon={User} label={c("colDriver")}>
                {offer.driver_id != null ? (
                  <button type="button" onClick={openDriver} className="link">
                    {offer.driver_name ?? "—"}
                  </button>
                ) : (
                  (offer.driver_name ?? "—")
                )}
              </KvRow>
              <KvRow icon={Wallet} label={c("colFare")}>
                <span className="num">{fare}</span>
              </KvRow>
              <KvRow icon={Clock} label={c("colTime")}>
                <span className="num">{offer.received_at ? new Date(offer.received_at).toLocaleString(latnLocale(locale)) : "—"}</span>
              </KvRow>
              {offer.trip_duration_seconds != null && (
                <KvRow icon={Timer} label={c("colDuration")}>
                  <span className="num">{toLatinDigits(`${Math.round(offer.trip_duration_seconds / 60)} min`)}</span>
                </KvRow>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KvRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="list-row" style={{ padding: "11px 0" }}>
      <span className="subtle">
        <Icon className="ico-sm" />
      </span>
      <span className="muted grow">{label}</span>
      <span className="strong" style={{ textAlign: "end" }}>{children}</span>
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

// Uber localises the address to the driver's app language, so it arrives with a
// trailing country segment ("…, Germany" / "…, Deutschland") or a non-Latin one
// (Arabic/Cyrillic). Strip those so the modal reads like the list row.
function tidyAddr(a: string): string {
  return a
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/[؀-ۿЀ-ӿ]/.test(p)) // drop Arabic/Cyrillic segments
    .filter(
      (p, i, arr) =>
        !(i === arr.length - 1 &&
          /^(germany|deutschland|allemagne|almanya|niemcy|alemania|germania|tyskland|duitsland|njemačka)$/i.test(p)),
    )
    .join(", ");
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
