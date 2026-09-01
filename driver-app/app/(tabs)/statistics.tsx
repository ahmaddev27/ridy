import { useCallback, useMemo, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useFocusEffect } from "expo-router";
import { api, type DriverStats, type DailyIncome } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, cardStyle } from "@/lib/theme";
import { fleetNow } from "@/lib/fleet-day";
import { fareLabel } from "@/lib/format";
import { SectionLabel } from "@/components/ui";
import { PeriodNavigator, periodWindow, ymd, addDays, mondayOf, type PeriodRange } from "@/components/period-navigator";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

export default function StatisticsScreen() {
  const c = useColors();
  const { isOwner } = useAuth();
  const align = isRTL() ? "right" : "left";
  const [range, setRange] = useState<PeriodRange>("week");
  const [offset, setOffset] = useState(0); // 0 = current period, negative = past
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [daily, setDaily] = useState<DailyIncome[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // The selected window + the Monday of the week its chart shows.
  const { window, weekMon, label } = useMemo(() => {
    const w = periodWindow(range, offset);
    return { window: { from: w.from, to: w.to }, weekMon: w.weekMonday, label: w.label };
  }, [range, offset]);

  const load = useCallback(
    async (win: { from: string; to: string }, mon: Date) => {
      setRefreshing(true);
      try {
        const wk = { from: ymd(mon), to: ymd(addDays(mon, 6)) };
        const [s, w] = await Promise.all([
          isOwner ? api.fleetStats(win.from, win.to) : api.stats(win.from, win.to),
          isOwner ? api.fleetStats(wk.from, wk.to) : api.stats(wk.from, wk.to),
        ]);
        setStats(s.data);
        setDaily(w.data.daily ?? []);
      } catch {
        /* keep last */
      } finally {
        setRefreshing(false);
      }
    },
    [isOwner],
  );

  useFocusEffect(useCallback(() => { load(window, weekMon); }, [load, window, weekMon]));

  const avgPerKm = stats && stats.km > 0 ? stats.earnings / stats.km : 0;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(window, weekMon)} tintColor={c.ink} />}
      >
        <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", textAlign: align }}>{t("stats.title")}</Text>

        {/* Uber-style range navigator: ‹ [ 24 Aug – 31 Aug ⌄ ] › — the centre pill
            opens the range-type picker (today/week/month); the arrows step the
            period and can't page into the future. */}
        <PeriodNavigator
          label={label}
          range={range}
          onRange={(r) => { setRange(r); setOffset(0); }}
          onPrev={() => setOffset((o) => o - 1)}
          onNext={() => setOffset((o) => Math.min(0, o + 1))}
          canNext={offset < 0}
        />

        {/* Total income hero */}
        <View style={{ ...cardStyle(c), padding: 18, gap: 6 }}>
          <SectionLabel>{t("stats.totalIncome")}</SectionLabel>
          <Text style={{ color: c.ink, fontSize: 36, fontWeight: "700", letterSpacing: -1, textAlign: align, writingDirection: "ltr" }}>
            {fareLabel(null, stats?.earnings ?? 0)}
          </Text>
        </View>

        {/* Income bars for the selected week */}
        <WeeklyChart daily={daily} c={c} monday={weekMon} />

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


/** Income bars for the week starting `monday` (Mon–Sun); future days are dimmed. */
function WeeklyChart({ daily, c, monday }: { daily: DailyIncome[]; c: Colors; monday: Date }) {
  const totals = useMemo(() => {
    const byDate = new Map(daily.map((d) => [d.date, d.income]));
    return Array.from({ length: 7 }, (_, i) => byDate.get(ymd(addDays(monday, i))) ?? 0);
  }, [daily, monday]);

  const max = Math.max(...totals, 1);
  const now = fleetNow();
  const todayIdx = sameDay(mondayOf(now), monday) ? mondayIndex(now) : -1;

  return (
    <View style={{ ...cardStyle(c), padding: 18, gap: 14 }}>
      <SectionLabel>{t("home.week")}</SectionLabel>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: 130, gap: 9 }}>
        {WEEKDAYS.map((wlabel, i) => {
          const date = addDays(monday, i);
          const future = date > now && !sameDay(date, now);
          const isToday = i === todayIdx;
          const h = 8 + (totals[i] / max) * 92;
          return (
            <View key={wlabel} style={{ flex: 1, alignItems: "center", gap: 8, opacity: future ? 0.4 : 1 }}>
              <View style={{ flex: 1, width: "100%", justifyContent: "flex-end", alignItems: "center" }}>
                <View style={{ height: h, width: "100%", borderRadius: 4, backgroundColor: isToday ? c.ink : c.borderStrong }} />
              </View>
              <Text style={{ color: isToday ? c.ink : c.inkSubtle, fontSize: 11, fontWeight: isToday ? "700" : "500" }}>{wlabel}</Text>
            </View>
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
