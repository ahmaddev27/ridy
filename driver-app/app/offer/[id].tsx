import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { api, type Offer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { fareLabel, perKmLabel, distanceLabel, cleanAddress, euroQuality } from "@/lib/format";
import { StatusBadge, QualityMark, RouteBlock, SectionLabel } from "@/components/ui";

const RING = 230;
const STROKE = 12;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

function useCountdown(offer: Offer | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timer.current = setInterval(() => setNow(Date.now()), 200);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);
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
  const expired = secondsLeft != null && secondsLeft <= 0;
  const q = offer ? euroQuality(offer.fare_amount, offer.distance_m) : { mark: "€", good: false };
  const ringColor = pct > 0.5 ? c.completed : pct > 0.25 ? c.pending : c.canceled;
  const hasMetrics = offer?.distance_m != null; // geo-synced offers only; hide the "—" placeholders otherwise

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      {/* Header */}
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: "absolute", [isRTL() ? "right" : "left"]: 16 }}>
          <Ionicons name={isRTL() ? "chevron-forward" : "chevron-back"} size={26} color={c.ink} />
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
                {secondsLeft != null && (
                  <Circle
                    cx={RING / 2} cy={RING / 2} r={R}
                    stroke={ringColor} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)}
                  />
                )}
              </Svg>
              <Text style={{ color: c.ink, fontSize: 44, fontWeight: "800", letterSpacing: -1 }}>{fareLabel(offer.fare_formatted, offer.fare_amount)}</Text>
              {hasMetrics && (
                <Text style={{ color: c.inkMuted, fontSize: 14, marginTop: 2 }}>
                  {perKmLabel(offer.fare_amount, offer.distance_m)} · {distanceLabel(offer.distance_m)}
                </Text>
              )}
            </View>
            {secondsLeft != null && (
              <Text style={{ color: ringColor, fontSize: 17, fontWeight: "700", marginTop: 6 }}>
                {expired ? t("offer.expired") : `${secondsLeft.toFixed(1)}s`}
              </Text>
            )}
          </View>

          {/* Status row */}
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <StatusBadge status={status} label={t(`status.${status}`)} />
            <QualityMark mark={q.mark} good={q.good} size={17} />
            {offer.received_at && (
              <Text style={{ color: c.inkSubtle, fontSize: 15 }}>
                {new Date(offer.received_at).toLocaleTimeString("en-GB")}
              </Text>
            )}
          </View>

          {/* Fleet-owner: attribute the offer to its driver. */}
          {isOwner && offer.driver_name && (
            <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 7 }}>
              <Ionicons name="person-circle-outline" size={18} color={c.inkMuted} />
              <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>{offer.driver_name}</Text>
              <Text style={{ color: c.inkSubtle, fontSize: 14 }}>· {t("fleet.driver")}</Text>
            </View>
          )}

          {/* Route card */}
          <View style={{ backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.line, padding: 18 }}>
            <RouteBlock
              pickup={cleanAddress(offer.pickup_address)}
              dropoff={cleanAddress(offer.dropoff_address)}
              pickupLabel={t("offer.abholung")}
              dropoffLabel={t("offer.ziel")}
            />
          </View>

          {/* Metrics — only when the offer has been geo-synced (otherwise the values are just "—"). */}
          {hasMetrics && (
            <View style={{ flexDirection: row, backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.line }}>
              <View style={{ flex: 1, padding: 16, gap: 4, borderRightWidth: isRTL() ? 0 : 1, borderLeftWidth: isRTL() ? 1 : 0, borderColor: c.line }}>
                <SectionLabel>{t("offer.strecke")}</SectionLabel>
                <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800", textAlign: isRTL() ? "right" : "left" }}>{distanceLabel(offer.distance_m)}</Text>
              </View>
              <View style={{ flex: 1, padding: 16, gap: 4 }}>
                <SectionLabel>{t("offer.qualitaet")}</SectionLabel>
                <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800", textAlign: isRTL() ? "right" : "left" }}>{perKmLabel(offer.fare_amount, offer.distance_m)}</Text>
              </View>
            </View>
          )}

          <View style={{ flex: 1 }} />

          {/* CTA — Open in Uber (primary) + Open in Maps (route) */}
          <View style={{ flexDirection: row, gap: 10, marginTop: 8 }}>
            <Pressable
              onPress={openMaps}
              style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, paddingVertical: 13, paddingHorizontal: 16 }}
            >
              <Ionicons name="map-outline" size={16} color={c.ink} />
              <Text style={{ color: c.ink, fontSize: 14, fontWeight: "700" }}>{t("offer.openMaps")}</Text>
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL("uberdriver://").catch(() => Linking.openURL("https://drivers.uber.com"))}
              style={{ flex: 1, backgroundColor: c.primary, borderRadius: radius.lg, paddingVertical: 13, alignItems: "center" }}
            >
              <Text style={{ color: c.primaryInk, fontSize: 15, fontWeight: "700" }}>{t("offer.openUber")}</Text>
            </Pressable>
          </View>
          <Text style={{ color: c.inkSubtle, fontSize: 12, textAlign: "center", lineHeight: 18 }}>{t("offer.observe")}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
