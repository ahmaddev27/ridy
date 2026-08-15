import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type HomeData } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { fareLabel, distanceLabel, perKmLabel, cleanAddress } from "@/lib/format";
import { StatCard, SectionTitle, StatusBadge } from "@/components/ui";

export default function HomeScreen() {
  const router = useRouter();
  const c = useColors();
  const [home, setHome] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const align = isRTL() ? "right" : "left";

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.home();
      setHome(res.data);
    } catch {
      /* keep the last snapshot on transient errors */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const today = home?.today;
  const active = home?.active_offer ?? null;
  const recent = (home?.recent ?? []).slice(0, 5);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      contentContainerStyle={{ padding: 16, gap: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={c.ink} />}
    >
      {/* Status pill */}
      {home && (
        <View style={{ gap: 12 }}>
          <Text style={{ color: c.ink, fontSize: 22, fontWeight: "800", textAlign: align }}>
            {t("home.greeting")}, {home.driver.name}
          </Text>
          <StatusPill online={home.driver.online} engagement={home.driver.engagement} />
        </View>
      )}

      {/* Today's stats */}
      {today && (
        <View style={{ gap: 12 }}>
          <SectionTitle>{t("home.today")}</SectionTitle>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <StatCard label={t("stat.offers")} value={String(today.total)} />
            <StatCard label={t("stat.accepted")} value={String(today.accepted)} tone={c.success} />
            <StatCard label={t("stat.acceptanceRate")} value={`${Math.round(today.acceptance_rate)}%`} />
            <StatCard label={t("stat.earnings")} value={fareLabel(null, today.earnings)} tone={c.accent} />
            <StatCard label={t("stat.km")} value={distanceLabel(today.km * 1000)} />
          </View>
        </View>
      )}

      {/* Active offer */}
      {active && (
        <View style={{ gap: 12 }}>
          <SectionTitle>{t("home.activeOffer")}</SectionTitle>
          <Pressable
            onPress={() => router.push(`/offer/${active.id}`)}
            style={{
              backgroundColor: c.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: c.accent,
              padding: 16,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: c.ink, fontSize: 26, fontWeight: "900" }}>
                {fareLabel(active.fare_formatted, active.fare_amount)}
              </Text>
              <Text style={{ color: c.accent, fontWeight: "700" }}>{perKmLabel(active.fare_amount, active.distance_m)}</Text>
            </View>
            <Text style={{ color: c.inkMuted }} numberOfLines={1}>
              ↑ {cleanAddress(active.pickup_address)}
            </Text>
            <Text style={{ color: c.inkSubtle }} numberOfLines={1}>
              ↓ {cleanAddress(active.dropoff_address)}
            </Text>
            <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: align }}>
              {distanceLabel(active.distance_m)}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Recent offers */}
      <View style={{ gap: 12 }}>
        <SectionTitle>{t("home.recent")}</SectionTitle>
        {recent.length === 0 ? (
          <Text style={{ color: c.inkSubtle, textAlign: align }}>{t("home.empty")}</Text>
        ) : (
          recent.map((o) => {
            const status = o.status ?? "pending";
            return (
              <Pressable
                key={o.id}
                onPress={() => router.push(`/offer/${o.id}`)}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: c.line,
                  padding: 14,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: c.ink, fontSize: 18, fontWeight: "800" }}>
                    {fareLabel(o.fare_formatted, o.fare_amount)}
                  </Text>
                  <StatusBadge status={status} label={t(`status.${status}`)} />
                </View>
                <Text style={{ color: c.inkMuted }} numberOfLines={1}>
                  ↑ {cleanAddress(o.pickup_address)}
                </Text>
                <Text style={{ color: c.inkSubtle }} numberOfLines={1}>
                  ↓ {cleanAddress(o.dropoff_address)}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function StatusPill({ online, engagement }: { online: boolean; engagement: 0 | 1 | 2 }) {
  const c = useColors();
  const dot = online ? c.success : c.inkSubtle;
  const label = online ? t(`home.engagement.${engagement}`) : t("home.offline");
  return (
    <View
      style={{
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 8,
        alignSelf: isRTL() ? "flex-end" : "flex-start",
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: dot }} />
      <Text style={{ color: c.ink, fontWeight: "600" }}>{online ? t("home.online") : t("home.offline")}</Text>
      {online && <Text style={{ color: c.inkSubtle }}>· {label}</Text>}
    </View>
  );
}
