import { useEffect, useMemo, useState } from "react";
import { View, Pressable, ActivityIndicator, Linking, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, User, UserCircle, Car, Map, type LucideIcon } from "lucide-react-native";
import Svg, { Circle } from "react-native-svg";
import { api, type Offer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle } from "@/lib/theme";
import { fareLabel, perKmLabel, distanceLabel, cleanAddress, euroQuality, timeLabel } from "@/lib/format";
import { StatusBadge, QualityMark, RouteBlock, SectionLabel, SecondaryButton } from "@/components/ui";

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

/**
 * Seconds remaining in the accept window, refreshed every animation frame so the
 * SVG ring depletes smoothly. The frame loop only runs while the offer is still
 * pending and the deadline is in the future; it stops itself the moment the
 * window elapses (or the status leaves "pending"), so no work is done once the
 * trip is active. Returns null when there is no accept window to count down.
 */
function useCountdown(offer: Offer | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!offer?.received_at || !offer.accept_window_seconds || offer.status !== "pending") return;
    const deadline = new Date(offer.received_at).getTime() + offer.accept_window_seconds * 1000;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() < deadline) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [offer]);
  return useMemo(() => {
    if (!offer?.received_at || !offer.accept_window_seconds) return null;
    const deadline = new Date(offer.received_at).getTime() + offer.accept_window_seconds * 1000;
    return Math.max(0, (deadline - now) / 1000);
  }, [offer, now]);
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

  useEffect(() => {
    const fetcher = isOwner ? api.fleetOffers({ per_page: 50 }) : api.offers();
    fetcher.then((r) => {
      const found = r.data.find((o) => String(o.id) === String(id));
      found ? setOffer(found) : setError(true);
    }).catch(() => setError(true));
  }, [id, isOwner]);

  function openMaps() {
    if (!offer) return;
    const origin = encodeURIComponent(offer.pickup_address ?? "");
    const dest = encodeURIComponent(offer.dropoff_address ?? "");
    // Opens the maps app with the full pickup → drop-off route (falls back to browser).
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`);
  }

  const status = offer?.status ?? "pending";
  const win = offer?.accept_window_seconds ?? 0;
  const pct = secondsLeft != null && win > 0 ? Math.max(0, Math.min(1, secondsLeft / win)) : 0;
  // The accept window (and therefore "expired") only applies while the offer is
  // still open. Once it has been accepted/started/completed the trip is active,
  // so the countdown must never override the live status with an "expired" label.
  const isPending = status === "pending";
  const expired = isPending && secondsLeft != null && secondsLeft <= 0;
  const q = offer ? euroQuality(offer.fare_amount, offer.distance_m) : { mark: "€", good: false };
  const ringColor = pct > 0.5 ? c.completed : pct > 0.25 ? c.pending : c.canceled;
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
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: "700" }}>{t("offer.header")}</Text>
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
              </Svg>
              {/* Big fare with the euro-quality mark right beside it — the same "€€"
                  the driver sees in the push notification (a price-per-km rating). */}
              <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "flex-start", gap: 6 }}>
                <Text style={{ color: c.ink, fontSize: 40, fontWeight: "800", letterSpacing: -1 }}>{fareLabel(offer.fare_formatted, offer.fare_amount)}</Text>
                <View style={{ marginTop: 5 }}><QualityMark mark={q.mark} good={q.good} size={18} /></View>
              </View>
              {hasMetrics && (
                <Text style={{ color: c.inkMuted, fontSize: 14, marginTop: 2 }}>
                  {perKmLabel(offer.fare_amount, offer.distance_m)} · {distanceLabel(offer.distance_m)}
                </Text>
              )}
            </View>
            {isPending && secondsLeft != null && (
              <Text style={{ color: ringColor, fontSize: 17, fontWeight: "700", marginTop: 6 }}>
                {expired ? t("offer.expired") : `${secondsLeft.toFixed(1)}s`}
              </Text>
            )}
            {/* Clarify the mark so "€€" never reads as a second price. */}
            <Text style={{ color: c.inkSubtle, fontSize: 12, textAlign: "center", marginTop: 8, lineHeight: 17, paddingHorizontal: 24 }}>
              {t("offer.qualityHint")}
            </Text>
          </View>

          {/* Status row */}
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <StatusBadge status={status} label={t(`status.${status}`)} />
            {offer.received_at && (
              <Text style={{ color: c.inkSubtle, fontSize: 15 }}>
                {new Date(offer.received_at).toLocaleTimeString("en-GB")}
              </Text>
            )}
          </View>

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

          {/* Route card */}
          <View style={{ ...cardStyle(c), padding: 18 }}>
            <RouteBlock
              pickup={cleanAddress(offer.pickup_address)}
              dropoff={cleanAddress(offer.dropoff_address)}
              pickupLabel={t("offer.abholung")}
              dropoffLabel={t("offer.ziel")}
            />
          </View>

          {/* Metrics — only when the offer has been geo-synced (otherwise the values are just "—"). */}
          {hasMetrics ? (
            <View style={{ flexDirection: row, ...cardStyle(c) }}>
              <MetricCell label={t("offer.strecke")} value={distanceLabel(offer.distance_m)} c={c} border />
              <MetricCell label={t("offer.qualitaet")} value={perKmLabel(offer.fare_amount, offer.distance_m)} c={c} border />
              <MetricCell label={t("offer.eta")} value={etaMin != null ? t("home.eta").replace("{n}", String(etaMin)) : "—"} c={c} />
            </View>
          ) : (
            // Distance / per-km / ETA depend on server-side geocoding — keep the dash
            // fallback but tell the driver why the numbers are not there yet.
            <View style={{ ...cardStyle(c), padding: 16 }}>
              <Text style={{ color: c.inkSubtle, fontSize: 13, lineHeight: 19, textAlign: isRTL() ? "right" : "left" }}>{t("offer.noGeo")}</Text>
            </View>
          )}

          {/* Timing — when the offer arrived, when Uber requested it, and the accept window. */}
          <View style={cardStyle(c)}>
            <InfoRow label={t("offer.received")} value={timeLabel(offer.received_at)} row={row} c={c} border />
            {offer.requested_at && (
              <InfoRow label={t("offer.requested")} value={timeLabel(offer.requested_at)} row={row} c={c} border />
            )}
            {offer.trip_duration_seconds != null && (
              <InfoRow label={t("offer.duration")} value={durationLabel(offer.trip_duration_seconds)} row={row} c={c} border />
            )}
            {isPending && win > 0 && (
              <InfoRow label={t("offer.acceptWindow")} value={`${win} ${t("common.seconds")}`} row={row} c={c} />
            )}
          </View>

          <View style={{ flex: 1 }} />

          {/* CTA — Open in Uber (primary) + Open in Maps (route) */}
          <View style={{ flexDirection: row, gap: 10, marginTop: 8 }}>
            <SecondaryButton label={t("offer.openMaps")} icon={Map} onPress={openMaps} />
            <Pressable
              onPress={() => Linking.openURL("uberdriver://").catch(() => Linking.openURL("https://drivers.uber.com"))}
              style={{ flex: 1, flexDirection: isRTL() ? "row-reverse" : "row", gap: 8, backgroundColor: c.primary, borderRadius: radius.lg, paddingVertical: 12, alignItems: "center", justifyContent: "center" }}
            >
              <Car size={17} color={c.primaryInk} />
              <Text style={{ color: c.primaryInk, fontSize: 15, fontWeight: "700" }}>{t("offer.openUber")}</Text>
            </Pressable>
          </View>
          <Text style={{ color: c.inkSubtle, fontSize: 12, textAlign: "center", lineHeight: 18 }}>{t("offer.observe")}</Text>
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
      <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>{name}</Text>
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
      <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800", textAlign: isRTL() ? "right" : "left", writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}

/** A label/value timing row inside the info card. */
function InfoRow({ label, value, row, c, border }: { label: string; value: string; row: "row" | "row-reverse"; c: Colors; border?: boolean }) {
  return (
    <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <Text style={{ color: c.inkMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 14, fontWeight: "700", writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}
