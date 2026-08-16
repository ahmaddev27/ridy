import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type HomeData, type Offer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { fareLabel, perKmLabel, distanceLabel, cleanAddress, euroQuality } from "@/lib/format";
import { Logo, StatusBadge, QualityMark, RouteBlock, SectionLabel } from "@/components/ui";

export default function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const { driver } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const row = isRTL() ? "row-reverse" : "row";
  const align = isRTL() ? "right" : "left";

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData((await api.home()).data);
    } catch {
      /* keep last */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const greeting = new Date().getHours() >= 17 ? t("home.greetingEvening") : t("home.greetingDay");
  const today = data?.today;
  const active = data?.active_offer ?? null;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={c.ink} />}
      >
        {/* Header */}
        <View style={{ flexDirection: row, alignItems: "center", gap: 12 }}>
          <Logo size={30} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 21, fontWeight: "800", textAlign: align }}>
              {greeting}, {data?.driver.name ?? "…"}
            </Text>
            {driver?.company_name && (
              <Text style={{ color: c.inkMuted, fontSize: 14, textAlign: align }}>{driver.company_name}</Text>
            )}
          </View>
          <OnlinePill online={!!data?.driver.online} />
        </View>

        {/* Today stats — 2×2 grid */}
        <View style={{ backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.line }}>
          <View style={{ flexDirection: row }}>
            <GridCell label={t("home.st.offers")} value={String(today?.total ?? 0)} c={c} border />
            <GridCell label={t("home.st.accept")} value={`${today?.acceptance_rate ?? 0}%`} c={c} />
          </View>
          <View style={{ height: 1, backgroundColor: c.line }} />
          <View style={{ flexDirection: row }}>
            <GridCell label={t("home.st.earnings")} value={fareLabel(null, today?.earnings ?? 0)} c={c} border />
            <GridCell label={t("home.st.distance")} value={String(today?.km ?? 0)} unit="km" c={c} />
          </View>
        </View>

        {/* Active offer */}
        {active && <ActiveOffer offer={active} onPress={() => router.push(`/offer/${active.id}`)} />}

        {/* Recent */}
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: "800" }}>{t("home.recent")}</Text>
          <Pressable onPress={() => router.push("/offers")}>
            <Text style={{ color: c.inkMuted, fontSize: 15 }}>{t("home.all")}</Text>
          </Pressable>
        </View>

        <View style={{ backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.line }}>
          {(data?.recent ?? []).length === 0 ? (
            <Text style={{ color: c.inkSubtle, textAlign: "center", padding: 24 }}>{t("home.empty")}</Text>
          ) : (
            data!.recent.map((o, i) => (
              <RecentRow key={o.id} offer={o} onPress={() => router.push(`/offer/${o.id}`)} last={i === data!.recent.length - 1} />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function OnlinePill({ online }: { online: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 7, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? c.completed : c.inkSubtle }} />
      <Text style={{ color: c.ink, fontSize: 14, fontWeight: "600" }}>{online ? t("home.online") : t("home.offline")}</Text>
    </View>
  );
}

function GridCell({ label, value, unit, c, border }: { label: string; value: string; unit?: string; c: ReturnType<typeof useColors>; border?: boolean }) {
  const align = isRTL() ? "right" : "left";
  return (
    <View style={{ flex: 1, padding: 18, gap: 6, borderRightWidth: border && !isRTL() ? 1 : 0, borderLeftWidth: border && isRTL() ? 1 : 0, borderColor: c.line }}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ color: c.ink, fontSize: 28, fontWeight: "800", textAlign: align }}>
        {value}
        {unit ? <Text style={{ fontSize: 16, fontWeight: "700", color: c.inkMuted }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function ActiveOffer({ offer, onPress }: { offer: Offer; onPress: () => void }) {
  const c = useColors();
  const row = isRTL() ? "row-reverse" : "row";
  const q = euroQuality(offer.fare_amount, offer.distance_m);
  const mins = offer.received_at ? Math.max(0, Math.round((Date.now() - new Date(offer.received_at).getTime()) / 60000)) : null;
  const km = offer.distance_m ? offer.distance_m / 1000 : null;
  const eta = km ? Math.round((km / 30) * 60) : null;

  return (
    <Pressable onPress={onPress} style={{ backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.line, padding: 18, gap: 14 }}>
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.started }} />
          <Text style={{ color: c.started, fontSize: 15, fontWeight: "700" }}>{t("status.started")}</Text>
        </View>
        {mins != null && <Text style={{ color: c.inkSubtle, fontSize: 14 }}>{t("home.ago").replace("{n}", String(mins))}</Text>}
      </View>

      <View style={{ flexDirection: row, alignItems: "flex-end", justifyContent: "space-between" }}>
        <Text style={{ color: c.ink, fontSize: 48, fontWeight: "800", letterSpacing: -1 }}>{fareLabel(offer.fare_formatted, offer.fare_amount)}</Text>
        <View style={{ alignItems: isRTL() ? "flex-start" : "flex-end", gap: 2 }}>
          <QualityMark mark={q.mark} good={q.good} size={18} />
          <Text style={{ color: c.inkMuted, fontSize: 14 }}>{perKmLabel(offer.fare_amount, offer.distance_m)}</Text>
        </View>
      </View>

      <RouteBlock pickup={cleanAddress(offer.pickup_address)} dropoff={cleanAddress(offer.dropoff_address)} />

      <View style={{ height: 1, backgroundColor: c.line, marginTop: 2 }} />
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.inkMuted, fontSize: 15 }}>
          {distanceLabel(offer.distance_m)}{eta ? ` · ${t("home.eta").replace("{n}", String(eta))}` : ""}
        </Text>
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: "700" }}>{t("home.details")}</Text>
          <Ionicons name={isRTL() ? "chevron-back" : "chevron-forward"} size={16} color={c.ink} />
        </View>
      </View>
    </Pressable>
  );
}

function RecentRow({ offer, onPress, last }: { offer: Offer; onPress: () => void; last: boolean }) {
  const c = useColors();
  const row = isRTL() ? "row-reverse" : "row";
  const status = offer.status ?? "pending";
  const dim = status === "rejected" || status === "canceled";
  const q = euroQuality(offer.fare_amount, offer.distance_m);
  return (
    <Pressable onPress={onPress} style={{ flexDirection: row, alignItems: "center", gap: 12, padding: 16, borderBottomWidth: last ? 0 : 1, borderColor: c.line, opacity: dim ? 0.55 : 1 }}>
      <View style={{ minWidth: 84 }}>
        <Text style={{ color: c.ink, fontSize: 18, fontWeight: "800", textAlign: isRTL() ? "right" : "left" }}>{fareLabel(offer.fare_formatted, offer.fare_amount)}</Text>
        <QualityMark mark={q.mark} good={q.good} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: c.inkMuted, fontSize: 14, textAlign: isRTL() ? "right" : "left" }}>{cleanAddress(offer.pickup_address)}</Text>
        <Text numberOfLines={1} style={{ color: c.ink, fontSize: 14, textAlign: isRTL() ? "right" : "left" }}>{cleanAddress(offer.dropoff_address)}</Text>
      </View>
      <StatusBadge status={status} label={t(`status.${status}`)} />
    </Pressable>
  );
}
