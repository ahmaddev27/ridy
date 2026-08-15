import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type Offer } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, type Palette } from "@/lib/theme";
import { fareLabel, distanceLabel, perKmLabel, cleanAddress } from "@/lib/format";
import { StatusBadge } from "@/components/ui";

/** Seconds left in the accept window, from the capture time + window length. */
function useCountdown(offer: Offer | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setNow(Date.now()), 250);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
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
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState(false);
  const secondsLeft = useCountdown(offer);
  const colors = useColors();

  useEffect(() => {
    api
      .offers()
      .then((r) => {
        const found = r.data.find((o) => String(o.id) === String(id));
        if (found) setOffer(found);
        else setError(true);
      })
      .catch(() => setError(true));
  }, [id]);

  if (error) {
    return (
      <Screen>
        <Text style={{ color: colors.inkSubtle }}>{t("offer.expired")}</Text>
      </Screen>
    );
  }
  if (!offer) {
    return (
      <Screen>
        <ActivityIndicator color={colors.ink} />
      </Screen>
    );
  }

  const status = offer.status ?? "pending";
  const window = offer.accept_window_seconds ?? 0;
  const pct = secondsLeft != null && window > 0 ? Math.max(0, Math.min(1, secondsLeft / window)) : 0;
  const expired = secondsLeft != null && secondsLeft <= 0;
  const barColor = pct > 0.5 ? colors.success : pct > 0.2 ? colors.warning : colors.danger;

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.ink, fontSize: 40, fontWeight: "900" }}>
          {fareLabel(offer.fare_formatted, offer.fare_amount)}
        </Text>
        <StatusBadge status={status} label={t(`status.${status}`)} />
      </View>

      {/* Countdown */}
      {secondsLeft != null && (
        <View style={{ gap: 8, marginTop: 20 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.inkMuted }}>{expired ? t("offer.expired") : t("offer.expiresIn")}</Text>
            {!expired && (
              <Text style={{ color: barColor, fontWeight: "800", fontSize: 16 }}>
                {Math.ceil(secondsLeft)} {t("common.seconds")}
              </Text>
            )}
          </View>
          <View style={{ height: 8, borderRadius: 999, backgroundColor: colors.surface2, overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${pct * 100}%`, backgroundColor: barColor }} />
          </View>
        </View>
      )}

      {/* Route */}
      <View style={{ marginTop: 24, gap: 14 }}>
        <Row label={t("offers.pickup")} value={cleanAddress(offer.pickup_address)} icon="location-outline" tone={colors.success} colors={colors} />
        <Row label={t("offers.dropoff")} value={cleanAddress(offer.dropoff_address)} icon="flag-outline" tone={colors.danger} colors={colors} />
        <Row label={t("offer.distance")} value={distanceLabel(offer.distance_m)} icon="navigate-outline" tone={colors.inkSubtle} colors={colors} />
        <Row label="€/km" value={perKmLabel(offer.fare_amount, offer.distance_m)} icon="cash-outline" tone={colors.inkSubtle} colors={colors} />
      </View>

      <Pressable
        onPress={() => Linking.openURL("uberdriver://").catch(() => Linking.openURL("https://drivers.uber.com"))}
        style={{ marginTop: "auto", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: "center" }}
      >
        <Text style={{ color: colors.primaryInk, fontWeight: "800", fontSize: 16 }}>{t("offer.openUber")}</Text>
      </Pressable>

      <Pressable onPress={() => router.back()} style={{ paddingVertical: 12, alignItems: "center" }}>
        <Ionicons name="close" size={22} color={colors.inkSubtle} />
      </Pressable>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 24, paddingTop: 40 }}>{children}</View>;
}

function Row({ label, value, icon, tone, colors }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; tone: string; colors: Palette }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={20} color={tone} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.inkSubtle, fontSize: 12, textAlign: isRTL() ? "right" : "left" }}>{label}</Text>
        <Text style={{ color: colors.ink, fontSize: 16, textAlign: isRTL() ? "right" : "left" }}>{value}</Text>
      </View>
    </View>
  );
}
