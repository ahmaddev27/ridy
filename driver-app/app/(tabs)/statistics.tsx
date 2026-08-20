import { useCallback, useMemo, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useFocusEffect } from "expo-router";
import { api, type DriverStats, type Offer } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle } from "@/lib/theme";
import { fareLabel } from "@/lib/format";
import { SectionLabel } from "@/components/ui";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

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
  const [day, setDay] = useState<Date | null>(null); // tapping a chart bar filters to one day
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [week, setWeek] = useState<Offer[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (r: Range, d: Date | null) => {
    setRefreshing(true);
    try {
      // Stats for the picked day (if any) or the selected range; the chart always
      // shows the last 7 days so you can tap another bar.
      const window = d ? { from: ymd(d), to: ymd(d) } : rangeDates(r);
      const w = rangeDates("7d");
      const [s, o] = await Promise.all([
        api.stats(window.from, window.to),
        api.offers({ from: w.from, to: w.to, per_page: 100 }),
      ]);
      setStats(s.data);
      setWeek(o.data);
    } catch {
      /* keep last */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(range, day); }, [load, range, day]));

  const avgPerKm = stats && stats.km > 0 ? stats.earnings / stats.km : 0;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(range, day)} tintColor={c.ink} />}
      >
        <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", textAlign: align }}>{t("stats.title")}</Text>

        {/* Range selector */}
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", gap: 8 }}>
          {RANGES.map((r) => {
            const on = range === r;
            return (
              <Pressable
                key={r}
                onPress={() => { setRange(r); setDay(null); }}
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
          <Text style={{ color: c.ink, fontSize: 36, fontWeight: "700", letterSpacing: -1, textAlign: align, writingDirection: "ltr" }}>
            {fareLabel(null, stats?.earnings ?? 0)}
          </Text>
        </View>

        {/* Selected-day filter chip */}
        {day && (
          <Pressable
            onPress={() => setDay(null)}
            style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignSelf: isRTL() ? "flex-end" : "flex-start", alignItems: "center", gap: 8, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ color: c.ink, fontSize: 12.5, fontWeight: "700", writingDirection: "ltr" }}>
              {day.toLocaleDateString("en-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}
            </Text>
            <Text style={{ color: c.inkSubtle, fontSize: 14, fontWeight: "700" }}>×</Text>
          </Pressable>
        )}

        {/* Last 7 days — income bars (tap a bar to filter to that day) */}
        <WeeklyChart offers={week} c={c} selected={day} onSelect={setDay} />

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

const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

/**
 * Income bars for the current week (Mon–Sun). Tapping a bar filters the whole
 * screen to that day; the selected (or today's) bar is emphasised. Future days
 * aren't tappable.
 */
function WeeklyChart({ offers, c, selected, onSelect }: { offers: Offer[]; c: Colors; selected: Date | null; onSelect: (d: Date | null) => void }) {
  const { totals, monday } = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    const now = new Date();
    const mon = new Date(now);
    mon.setHours(0, 0, 0, 0);
    mon.setDate(now.getDate() - mondayIndex(now));
    const nextMonday = new Date(mon);
    nextMonday.setDate(mon.getDate() + 7);
    for (const o of offers) {
      if (!o.received_at || o.fare_amount == null) continue;
      if (o.status === "rejected" || o.status === "canceled") continue;
      const at = new Date(o.received_at);
      if (at < mon || at >= nextMonday) continue;
      buckets[mondayIndex(at)] += o.fare_amount;
    }
    return { totals: buckets, monday: mon };
  }, [offers]);

  const max = Math.max(...totals, 1);
  const now = new Date();
  const todayIdx = mondayIndex(now);

  return (
    <View style={{ ...cardStyle(c), padding: 18, gap: 14 }}>
      <SectionLabel>{t("home.week")}</SectionLabel>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: 130, gap: 9 }}>
        {WEEKDAYS.map((label, i) => {
          const date = new Date(monday);
          date.setDate(monday.getDate() + i);
          const future = date > now && !sameDay(date, now);
          const isSelected = selected ? sameDay(date, selected) : i === todayIdx;
          const h = 8 + (totals[i] / max) * 92;
          return (
            <Pressable
              key={label}
              disabled={future}
              onPress={() => onSelect(selected && sameDay(date, selected) ? null : date)}
              style={{ flex: 1, alignItems: "center", gap: 8, opacity: future ? 0.4 : 1 }}
            >
              <View style={{ flex: 1, width: "100%", justifyContent: "flex-end", alignItems: "center" }}>
                <View style={{ height: h, width: "100%", borderRadius: 4, backgroundColor: isSelected ? (selected ? c.accent : c.ink) : c.borderStrong }} />
              </View>
              <Text style={{ color: isSelected ? c.ink : c.inkSubtle, fontSize: 11, fontWeight: isSelected ? "700" : "500" }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Cell({ label, value, unit, c, border }: { label: string; value: string; unit?: string; c: Colors; border?: boolean }) {
  const align = isRTL() ? "right" : "left";
  return (
    <View style={{ flex: 1, padding: 16, gap: 5, borderRightWidth: border && !isRTL() ? 1 : 0, borderLeftWidth: border && isRTL() ? 1 : 0, borderColor: c.line }}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ color: c.ink, fontSize: 24, fontWeight: "700", textAlign: align, writingDirection: "ltr" }}>
        {value}
        {unit ? <Text style={{ fontSize: 15, fontWeight: "500", color: c.inkMuted }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function Row({ label, value, c, border }: { label: string; value: string; c: Colors; border?: boolean }) {
  const row = isRTL() ? "row-reverse" : "row";
  return (
    <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <Text style={{ color: c.inkMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600", writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}
