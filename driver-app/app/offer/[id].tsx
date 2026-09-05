import { useEffect, useMemo, useState } from "react";
import { View, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, User, UserCircle, Map, Route, type LucideIcon } from "lucide-react-native";
import Svg, { Circle } from "react-native-svg";
import { api, type Offer } from "@/lib/api";
import { openRouteInMaps } from "@/lib/maps";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle } from "@/lib/theme";
import { fareLabel, perKmValue, perKmLabel, distanceLabel, cleanAddress, timeLabel } from "@/lib/format";
import { StatusBadge, RouteBlock, SectionLabel, SecondaryButton } from "@/components/ui";

/** "19 Min" / "45 Sek" / "1 Std 5 Min" — how long the trip took. */
function durationLabel(sec: number): string {
  if (sec < 60) return `${sec} ${t("offer.secShort")}`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} ${t("offer.minShort")}`;
  return `${Math.floor(m / 60)} ${t("offer.hrShort")} ${m % 60} ${t("offer.minShort")}`;
}

const RING = 216;
const STROKE = 10;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

/** Accept-window fallback (seconds) when the offer carries no real window. */
const COUNTDOWN_FALLBACK_SECONDS = 10;

/** The offer's real accept window in seconds, falling back to the default. */
function acceptWindow(offer: Offer | null): number {
  return offer?.accept_window_seconds ?? COUNTDOWN_FALLBACK_SECONDS;
}

/**
 * Seconds remaining in the accept window, refreshed every animation frame so the
 * SVG ring depletes smoothly. The frame loop only runs while the offer is still
 * pending and the deadline is in the future; it stops itself the moment the
 * window elapses (or the status leaves "pending"), so no work is done once the
 * trip is active. Returns null when there is no accept window to count down.
 *
 * Keyed on the offer's identity/received_at/status (not the whole object) so a
 * 4s re-fetch that returns an equivalent offer does NOT restart the RAF loop.
 */
function useCountdown(offer: Offer | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const receivedAt = offer?.received_at ?? null;
  const status = offer?.status ?? null;
  const windowSeconds = acceptWindow(offer);
  useEffect(() => {
    if (!receivedAt || status !== "pending") return;
    const deadline = new Date(receivedAt).getTime() + windowSeconds * 1000;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() < deadline) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [receivedAt, status, windowSeconds]);
  return useMemo(() => {
    if (!receivedAt) return null;
    const deadline = new Date(receivedAt).getTime() + windowSeconds * 1000;
    return Math.max(0, (deadline - now) / 1000);
  }, [receivedAt, windowSeconds, now]);
}

export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useColors();
  const { isOwner } = useAuth();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState(false);
  const secondsLeft = useCountdown(offer);
  const row = isRTL() ? "row-reverse" : "row";

  // Load once, then poll so the status tracks the backend lifecycle (pending →
  // rejected / accepted / started / completed / canceled), just like the
  // dashboard — instead of a local "expired" that never updates.
  useEffect(() => {
    let alive = true;
    const load = () => {
      const fetcher = isOwner ? api.fleetOffer(id) : api.offer(id);
      fetcher
        .then((r) => {
          if (!alive) return;
          setOffer(r.data);
          setError(false);
        })
        .catch(() => alive && setError(true));
    };
    load();
    const iv = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [id, isOwner]);

  function openMaps() {
    if (!offer) return;
    // Opens the maps app with the full pickup → drop-off route, including any
    // intermediate stops of a multi-stop trip as waypoints (falls back to browser).
    openRouteInMaps(offer.pickup_address, offer.dropoff_address, offer.stops);
  }

  const status = offer?.status ?? "pending";
  const win = acceptWindow(offer);
  const pct = secondsLeft != null && win > 0 ? Math.max(0, Math.min(1, secondsLeft / win)) : 0;
  // The status LABEL is driven ONLY by the backend `offer.status`, never by the
  // local countdown. The backend deliberately HOLDS an offer as `pending` while
  // the driver is busy (it's taken back-to-back, or rejected only once idle), so a
  // depleted local timer must never relabel a pending offer as expired/declined —
  // it keeps showing the pending/waiting state until the backend moves it on. The
  // ring may still visually deplete; `counting` only decides whether the live
  // seconds are shown, not the status.
  const isPending = status === "pending";
  const counting = isPending && secondsLeft != null && secondsLeft > 0;
  const ringColor = pct > 0.5 ? c.completed : pct > 0.25 ? c.pending : c.canceled;

  // Once the offer is taken, the ring stops being a countdown and becomes a
  // lifecycle progress meter in our deep green: accepted (driver → pickup) →
  // started (on trip) → completed (trip done). The percentage replaces the
  // status word beneath the fare.
  const PROGRESS_GREEN = "#059669";
  const LIFECYCLE_PROGRESS: Record<string, number> = { accepted: 1 / 3, started: 2 / 3, completed: 1 };
  const lifePct = LIFECYCLE_PROGRESS[status];
  const showProgress = lifePct !== undefined;
  const hasMetrics = offer?.distance_m != null; // geo-synced offers only; hide the "—" placeholders otherwise
  // Rough ETA at ~30 km/h city average — same derivation the home ActiveOffer uses.
  const km = offer?.distance_m ? offer.distance_m / 1000 : null;
  const etaMin = km ? Math.round((km / 30) * 60) : null;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      {/* Header */}
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: "absolute", [isRTL() ? "right" : "left"]: 16 }}>
          {isRTL() ? <ChevronRight size={26} color={c.ink} /> : <ChevronLeft size={26} color={c.ink} />}
        </Pressable>
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>{t("offer.header")}</Text>
      </View>

      {!offer ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {error ? <Text style={{ color: c.inkSubtle }}>{t("offer.expired")}</Text> : <ActivityIndicator color={c.ink} />}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 18 }}>
          {/* Countdown ring */}
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <View style={{ width: RING, height: RING, alignItems: "center", justifyContent: "center" }}>
              <Svg width={RING} height={RING} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
                <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={c.line} strokeWidth={STROKE} fill="none" />
                {isPending && secondsLeft != null && (
                  <Circle
                    cx={RING / 2} cy={RING / 2} r={R}
                    stroke={ringColor} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)}
                  />
                )}
                {showProgress && (
                  <Circle
                    cx={RING / 2} cy={RING / 2} r={R}
                    stroke={PROGRESS_GREEN} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - lifePct)}
                  />
                )}
              </Svg>
              {/* Hero is the €/km rate — the number the driver judges in ~5s. The
                  total fare sits beneath it as the secondary figure. Falls back to
                  the total when the trip is not geo-synced yet (no per-km). */}
              {/* Hero is the trip total (the one bold figure); €/km sits beneath it. */}
              {(() => {
                const perKm = offer.distance_m != null ? perKmValue(offer.fare_amount, offer.distance_m) : null;
                return (
                  <>
                    <Text style={{ color: c.ink, fontSize: 40, fontWeight: "800", letterSpacing: -1.5 }}>
                      {fareLabel(offer.fare_formatted, offer.fare_amount)}
                    </Text>
                    {perKm && (
                      <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 3, writingDirection: "ltr" }}>
                        {perKm.value} <Text style={{ color: c.inkSubtle }}>€/km</Text>
                      </Text>
                    )}
                  </>
                );
              })()}
            </View>
            {/* While pending + counting: the seconds left. Once the local window
                passes, a STILL-pending offer keeps showing the pending badge (the
                backend holds it while the driver is busy) — never "expired". The
                badge label always comes from the backend status: pending, then
                rejected / accepted / started / completed / canceled. */}
            {counting ? (
              <Text style={{ color: ringColor, fontSize: 16, fontWeight: "600", marginTop: 6 }}>
                {`${secondsLeft!.toFixed(1)}s`}
              </Text>
            ) : showProgress ? (
              // Trip lifecycle progress: the percentage replaces the status word.
              <Text style={{ color: PROGRESS_GREEN, fontSize: 18, fontWeight: "700", marginTop: 8 }}>
                {`${Math.round(lifePct * 100)}%`}
              </Text>
            ) : (
              <View style={{ marginTop: 8 }}>
                <StatusBadge status={status} label={t(`status.${status}`)} />
              </View>
            )}
          </View>

          {/* Received time (the status now lives in the badge under the ring). */}
          {offer.received_at && (
            <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: c.inkSubtle, fontSize: 15 }}>
                {new Date(offer.received_at).toLocaleTimeString("en-GB")}
              </Text>
            </View>
          )}

          {/* Quick action: open the pickup → drop-off route in the maps app. */}
          <SecondaryButton label={t("offer.openMaps")} icon={Map} onPress={openMaps} />

          {/* People — rider (when captured) and, in fleet-owner mode, the driver. */}
          {(offer.rider_name || (isOwner && offer.driver_name)) && (
            <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
              {offer.rider_name && (
                <PersonTag icon={User} name={offer.rider_name} role={t("offer.rider")} row={row} c={c} />
              )}
              {isOwner && offer.driver_name && (
                <PersonTag icon={UserCircle} name={offer.driver_name} role={t("fleet.driver")} row={row} c={c} />
              )}
            </View>
          )}

          {/* Route card — a multi-stop trip lists every drop-off with its per-leg km. */}
          <View style={{ ...cardStyle(c), padding: 18, gap: 12 }}>
            {(offer.stops_count ?? 0) >= 2 && (
              <View style={{ flexDirection: row, alignItems: "center", gap: 6 }}>
                <Route size={15} color={c.pending} />
                <Text style={{ color: c.pending, fontSize: 13, fontWeight: "700" }}>
                  {t("offer.multiStop")} · {offer.stops_count} {t("offer.dropoffs")}
                </Text>
              </View>
            )}
            <RouteBlock
              pickup={offer.pickup_station_name ? `${offer.pickup_station_name}, ${cleanAddress(offer.pickup_address)}` : cleanAddress(offer.pickup_address)}
              dropoff={offer.dropoff_station_name ? `${offer.dropoff_station_name}, ${cleanAddress(offer.dropoff_address)}` : cleanAddress(offer.dropoff_address)}
              pickupLabel={t("offer.abholung")}
              dropoffLabel={t("offer.ziel")}
              stops={
                offer.stops && offer.stops.length > 2
                  ? offer.stops.map((s) => ({ address: cleanAddress(s.address ?? ""), legKm: s.leg_m != null ? s.leg_m / 1000 : null }))
                  : undefined
              }
            />
          </View>

          {/* Metrics — only when the offer has been geo-synced (otherwise the values are just "—").
              The third cell prefers the ACTUAL trip duration once the trip finished,
              and only falls back to the estimated ETA while it is still in flight —
              so there is one, unambiguous duration (no estimate-vs-actual clash). */}
          {hasMetrics ? (
            <View style={{ flexDirection: row, ...cardStyle(c) }}>
              <MetricCell label={t("offer.strecke")} value={distanceLabel(offer.distance_m)} c={c} border />
              <MetricCell label={t("offer.qualitaet")} value={perKmLabel(offer.fare_amount, offer.distance_m)} c={c} border />
              {offer.trip_duration_seconds != null ? (
                <MetricCell label={t("offer.duration")} value={durationLabel(offer.trip_duration_seconds)} c={c} />
              ) : (
                <MetricCell label={t("offer.eta")} value={etaMin != null ? t("home.eta").replace("{n}", String(etaMin)) : "—"} c={c} />
              )}
            </View>
          ) : (
            // Distance / per-km / ETA depend on server-side geocoding — keep the dash
            // fallback but tell the driver why the numbers are not there yet.
            <View style={{ ...cardStyle(c), padding: 16 }}>
              <Text style={{ color: c.inkSubtle, fontSize: 13, lineHeight: 19, textAlign: isRTL() ? "right" : "left" }}>{t("offer.noGeo")}</Text>
            </View>
          )}

          {/* Timing — arrival, Uber request time, and (while live) the accept window.
              Trip duration is shown in the metrics above, so it is not repeated here.
              The last row never draws a bottom border (no trailing hairline). */}
          {(() => {
            const rows = [
              { label: t("offer.received"), value: timeLabel(offer.received_at) },
              ...(offer.requested_at ? [{ label: t("offer.requested"), value: timeLabel(offer.requested_at) }] : []),
              ...(isPending && win > 0 ? [{ label: t("offer.acceptWindow"), value: `${win} ${t("common.seconds")}` }] : []),
            ];
            return (
              <View style={cardStyle(c)}>
                {rows.map((r, i) => (
                  <InfoRow key={r.label} label={r.label} value={r.value} row={row} c={c} border={i < rows.length - 1} />
                ))}
              </View>
            );
          })()}

          <Text style={{ color: c.inkSubtle, fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 4 }}>{t("offer.observe")}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

type Colors = ReturnType<typeof useColors>;

/** Icon + name + role, used for the rider and (owner mode) driver attribution. */
function PersonTag({ icon: Icon, name, role, row, c }: { icon: LucideIcon; name: string; role: string; row: "row" | "row-reverse"; c: Colors }) {
  return (
    <View style={{ flexDirection: row, alignItems: "center", gap: 7 }}>
      <Icon size={18} color={c.inkMuted} />
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "500" }}>{name}</Text>
      <Text style={{ color: c.inkSubtle, fontSize: 14 }}>· {role}</Text>
    </View>
  );
}

/** One equal-width cell in the distance / per-km / ETA metrics strip. */
function MetricCell({ label, value, c, border }: { label: string; value: string; c: Colors; border?: boolean }) {
  return (
    <View style={{ flex: 1, padding: 16, gap: 4, borderRightWidth: border && !isRTL() ? 1 : 0, borderLeftWidth: border && isRTL() ? 1 : 0, borderColor: c.line }}>
      <SectionLabel>{label}</SectionLabel>
      {/* Latin/money values stay LTR even in Arabic, matching how Uber shows them. */}
      <Text style={{ color: c.ink, fontSize: 16, fontWeight: "500", textAlign: isRTL() ? "right" : "left", writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}

/** A label/value timing row inside the info card. */
function InfoRow({ label, value, row, c, border }: { label: string; value: string; row: "row" | "row-reverse"; c: Colors; border?: boolean }) {
  return (
    <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <Text style={{ color: c.inkMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 14, fontWeight: "500", writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}
