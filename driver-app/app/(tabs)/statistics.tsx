import { useCallback, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useFocusEffect } from "expo-router";
import { api, type DriverStats } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle } from "@/lib/theme";
import { fareLabel } from "@/lib/format";
import { SectionLabel } from "@/components/ui";

type Range = "today" | "7d" | "30d";
const RANGES: Range[] = ["today", "7d", "30d"];

/** Local yyyy-mm-dd (native date range for the stats endpoint). */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** from/to for a rolling range (today / last 7 / last 30 days). */
function rangeDates(r: Range): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  if (r === "7d") start.setDate(now.getDate() - 6);
  else if (r === "30d") start.setDate(now.getDate() - 29);
  return { from: ymd(start), to: ymd(now) };
}

export default function StatisticsScreen() {
  const c = useColors();
  const align = isRTL() ? "right" : "left";
  const [range, setRange] = useState<Range>("7d");
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (r: Range) => {
    setRefreshing(true);
    try {
      const { from, to } = rangeDates(r);
      setStats((await api.stats(from, to)).data);
    } catch {
      /* keep last */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(range); }, [load, range]));

  const avgPerKm = stats && stats.km > 0 ? stats.earnings / stats.km : 0;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(range)} tintColor={c.ink} />}
      >
        <Text style={{ color: c.ink, fontSize: 26, fontWeight: "800", textAlign: align }}>{t("stats.title")}</Text>

        {/* Range selector */}
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", gap: 8 }}>
          {RANGES.map((r) => {
            const on = range === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRange(r)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  backgroundColor: on ? c.primary : c.surface,
                  borderWidth: 1,
                  borderColor: on ? c.primary : c.line,
                }}
              >
                <Text style={{ color: on ? c.primaryInk : c.inkMuted, fontSize: 13.5, fontWeight: "700" }}>
                  {t(`range.${r}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Total income hero */}
        <View style={{ ...cardStyle(c), padding: 18, gap: 6 }}>
          <SectionLabel>{t("stats.totalIncome")}</SectionLabel>
          <Text style={{ color: c.ink, fontSize: 36, fontWeight: "800", letterSpacing: -1, textAlign: align, writingDirection: "ltr" }}>
            {fareLabel(null, stats?.earnings ?? 0)}
          </Text>
        </View>

        {/* 2×2 grid */}
        <View style={cardStyle(c)}>
          <View style={{ flexDirection: isRTL() ? "row-reverse" : "row" }}>
            <Cell label={t("stat.offers")} value={String(stats?.total ?? 0)} c={c} border />
            <Cell label={t("stat.accepted")} value={String(stats?.accepted ?? 0)} c={c} />
          </View>
          <View style={{ height: 1, backgroundColor: c.line }} />
          <View style={{ flexDirection: isRTL() ? "row-reverse" : "row" }}>
            <Cell label={t("stats.avgPerKm")} value={fareLabel(null, avgPerKm)} c={c} border />
            <Cell label={t("stat.km")} value={String(Math.round(stats?.km ?? 0))} unit="km" c={c} />
          </View>
        </View>

        {/* Inset list: completed + acceptance rate */}
        <View style={cardStyle(c)}>
          <Row label={t("stat.completed")} value={String(stats?.completed ?? 0)} c={c} border />
          <Row label={t("stat.acceptanceRate")} value={`${stats?.acceptance_rate ?? 0}%`} c={c} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type Colors = ReturnType<typeof useColors>;

function Cell({ label, value, unit, c, border }: { label: string; value: string; unit?: string; c: Colors; border?: boolean }) {
  const align = isRTL() ? "right" : "left";
  return (
    <View style={{ flex: 1, padding: 16, gap: 5, borderRightWidth: border && !isRTL() ? 1 : 0, borderLeftWidth: border && isRTL() ? 1 : 0, borderColor: c.line }}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ color: c.ink, fontSize: 24, fontWeight: "800", textAlign: align, writingDirection: "ltr" }}>
        {value}
        {unit ? <Text style={{ fontSize: 15, fontWeight: "700", color: c.inkMuted }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function Row({ label, value, c, border }: { label: string; value: string; c: Colors; border?: boolean }) {
  const row = isRTL() ? "row-reverse" : "row";
  return (
    <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <Text style={{ color: c.inkMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "700", writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}
