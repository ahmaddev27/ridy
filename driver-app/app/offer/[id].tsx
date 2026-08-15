import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, type Offer } from "@/lib/api";
import { t } from "@/lib/i18n";
import { colors, radius } from "@/lib/theme";
import { fareLabel, distanceLabel } from "@/lib/format";
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
        <StatusBadge status={status} label={status} />
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
        <Row label={t("offers.pickup")} value={offer.pickup_address ?? "—"} glyph="↑" />
        <Row label={t("offers.dropoff")} value={offer.dropoff_address ?? "—"} glyph="↓" />
        <Row label={t("offer.distance")} value={distanceLabel(offer.distance_m)} glyph="•" />
      </View>

      <Pressable
        onPress={() => Linking.openURL("uberdriver://").catch(() => Linking.openURL("https://drivers.uber.com"))}
        style={{ marginTop: "auto", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: "center" }}
      >
        <Text style={{ color: colors.primaryInk, fontWeight: "800", fontSize: 16 }}>{t("offer.openUber")}</Text>
      </Pressable>

      <Pressable onPress={() => router.back()} style={{ paddingVertical: 12, alignItems: "center" }}>
        <Text style={{ color: colors.inkSubtle }}>✕</Text>
      </Pressable>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 24, paddingTop: 40 }}>{children}</View>;
}

function Row({ label, value, glyph }: { label: string; value: string; glyph: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <Text style={{ color: colors.inkSubtle, fontSize: 18, width: 18 }}>{glyph}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: colors.ink, fontSize: 16 }}>{value}</Text>
      </View>
    </View>
  );
}
