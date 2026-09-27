import { memo, useEffect, useState } from "react";
import { View, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, User, UserCircle, Map, Route, type LucideIcon } from "@/components/icons";
import Svg, { Circle } from "react-native-svg";
import { api, ApiError, type Offer } from "@/lib/api";
import { openRouteInMaps } from "@/lib/maps";
import { useAuth } from "@/lib/auth";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, radius, cardStyle } from "@/lib/theme";
import { fareLabel, perKmValue, perKmLabel, distanceLabel, cleanAddress, timeLabel } from "@/lib/format";
import { StatusBadge, RouteBlock, SectionLabel, SecondaryButton } from "@/components/ui";
import { useLiveReload } from "@/lib/use-live-reload";

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

/** Statuses after which nothing about the offer changes any more. */
const TERMINAL_STATUSES = new Set(["completed", "rejected", "canceled"]);

/** Deadline of the accept window (ms epoch), or null without a received time. */
function deadlineOf(receivedAt: string | null, windowSeconds: number): number | null {
  const received = receivedAt ? Date.parse(receivedAt) : NaN;
  return Number.isFinite(received) ? received + windowSeconds * 1000 : null;
}

/**
 * Seconds left in the accept window, re-rendering ONLY the component that uses
 * it, and only when the shown tenth changes (100 ms ticks) — the rest of the
 * offer screen no longer re-renders every animation frame.
 */
function useSecondsLeft(deadline: number | null, active: boolean): number | null {
  const compute = () => (deadline === null ? null : Math.max(0, Math.round((deadline - Date.now()) / 100) / 10));
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    setLeft(compute());
    if (deadline === null || !active || Date.now() >= deadline) return;
    const id = setInterval(() => {
      const next = compute();
      setLeft((prev) => (prev === next ? prev : next));
      if (Date.now() >= deadline) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [deadline, active]);
  return left;
}

/** True until the deadline passes — flips once (a single timeout, no ticking). */
function useWindowOpen(deadline: number | null, active: boolean): boolean {
  const [open, setOpen] = useState(() => deadline !== null && active && Date.now() < deadline);
  useEffect(() => {
    const isOpen = deadline !== null && active && Date.now() < deadline;
    setOpen(isOpen);
    if (!isOpen || deadline === null) return;
    const id = setTimeout(() => setOpen(false), deadline - Date.now());
    return () => clearTimeout(id);
  }, [deadline, active]);
  return open;
}

function ringColorFor(pct: number, c: ReturnType<typeof useColors>): string {
  return pct > 0.5 ? c.completed : pct > 0.25 ? c.pending : c.canceled;
}

/** The depleting countdown arc, drawn over the static track. */
const CountdownArc = memo(function CountdownArc({ deadline, windowSeconds }: { deadline: number | null; windowSeconds: number }) {
  const c = useColors();
  const left = useSecondsLeft(deadline, true);
  if (left === null) return null;
  const pct = windowSeconds > 0 ? Math.max(0, Math.min(1, left / windowSeconds)) : 0;
  return (
    <Svg width={RING} height={RING} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
      <Circle
        cx={RING / 2} cy={RING / 2} r={R}
        stroke={ringColorFor(pct, c)} strokeWidth={STROKE} fill="none" strokeLinecap="round"
        strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)}
      />
    </Svg>
  );
});

/** The live "4.2s" label under the fare. */
const CountdownLabel = memo(function CountdownLabel({ deadline, windowSeconds }: { deadline: number | null; windowSeconds: number }) {
  const c = useColors();
  const left = useSecondsLeft(deadline, true);
  if (left === null) return null;
  const pct = windowSeconds > 0 ? Math.max(0, Math.min(1, left / windowSeconds)) : 0;
  return (
    <Text style={{ color: ringColorFor(pct, c), fontSize: 16, fontWeight: "600", marginTop: 6, writingDirection: "ltr" }}>
      {`${left.toFixed(1)}s`}
    </Text>
  );
});

/** What went wrong loading the offer: gone for good vs. a transient failure. */
type LoadFailure = "not_found" | "retry" | null;

export default function OfferScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  // A deep link (reidey://offer/...) is attacker-controlled: numeric ids only.
  const id = typeof rawId === "string" && /^\d+$/.test(rawId) ? rawId : null;
  const router = useRouter();
  const c = useColors();
  const { isOwner } = useAuth();
  useLocale(); // re-render on a language switch
  const [offer, setOffer] = useState<Offer | null>(null);
  const [failure, setFailure] = useState<LoadFailure>(id ? null : "not_found");
  const row = isRTL() ? "row-reverse" : "row";

  // Load, then keep the status in sync with the backend lifecycle (pending →
  // rejected / accepted / started / completed / canceled): poll every 4s while
  // the socket is down, slowly while it is up, and on every event for THIS
  // offer. Stops once the offer reaches a final state.
  const finished = offer !== null && TERMINAL_STATUSES.has(offer.status ?? "");
  useLiveReload(
    async () => {
      if (!id) return;
      try {
        const r = await (isOwner ? api.fleetOffer(id) : api.offer(id));
        setOffer(r.data);
        setFailure(null);
      } catch (e) {
        // 404/403: gone or not ours. Anything else (offline, timeout, 5xx) is
        // transient — keep polling and never call it "expired".
        const gone = e instanceof ApiError && (e.status === 404 || e.status === 403);
        setFailure(gone ? "not_found" : "retry");
      }
    },
    {
      fastMs: 4_000,
      slowMs: 15_000,
      enabled: id !== null && !finished,
      accept: (e) => e.offerId === undefined || String(e.offerId) === id,
    },
  );

  function openMaps() {
    if (!offer) return;
    // Opens the maps app with the full pickup → drop-off route, including any
    // intermediate stops of a multi-stop trip as waypoints (falls back to browser).
    openRouteInMaps({
      pickup: offer.pickup_address,
      dropoff: offer.dropoff_address,
      pickupPoint: { lat: offer.pickup_lat, lng: offer.pickup_lng },
      dropoffPoint: { lat: offer.dropoff_lat, lng: offer.dropoff_lng },
      stops: offer.stops,
      exact: offer.geo_source === "uber",
    });
  }

  const status = offer?.status ?? "pending";
  const win = acceptWindow(offer);
  const deadline = deadlineOf(offer?.received_at ?? null, win);
  // The status LABEL is driven ONLY by the backend `offer.status`, never by the
  // local countdown. The backend deliberately HOLDS an offer as `pending` while
  // the driver is busy (it's taken back-to-back, or rejected only once idle), so a
  // depleted local timer must never relabel a pending offer as expired/declined —
  // it keeps showing the pending/waiting state until the backend moves it on. The
  // ring may still visually deplete; `counting` only decides whether the live
  // seconds are shown, not the status.
  const isPending = status === "pending";
  const counting = useWindowOpen(deadline, isPending);

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
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          style={{ position: "absolute", [isRTL() ? "right" : "left"]: 16 }}
        >
          {isRTL() ? <ChevronRight size={26} color={c.ink} /> : <ChevronLeft size={26} color={c.ink} />}
        </Pressable>
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>{t("offer.header")}</Text>
      </View>

      {!offer ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {failure === "not_found" ? (
            <Text style={{ color: c.inkSubtle }}>{t("offer.notFound")}</Text>
          ) : (
            <View style={{ alignItems: "center", gap: 12 }}>
              <ActivityIndicator color={c.ink} />
              {failure === "retry" && (
                <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: "center" }}>{t("offer.reconnecting")}</Text>
              )}
            </View>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 18 }}>
          {/* Countdown ring */}
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <View style={{ width: RING, height: RING, alignItems: "center", justifyContent: "center" }}>
              <Svg width={RING} height={RING} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
                <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={c.line} strokeWidth={STROKE} fill="none" />
                {showProgress && (
                  <Circle
                    cx={RING / 2} cy={RING / 2} r={R}
                    stroke={PROGRESS_GREEN} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - lifePct)}
                  />
                )}
              </Svg>
              {isPending && <CountdownArc deadline={deadline} windowSeconds={win} />}
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
              <CountdownLabel deadline={deadline} windowSeconds={win} />
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
