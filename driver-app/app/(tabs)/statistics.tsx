import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView, RefreshControl, AppState } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useFocusEffect } from "expo-router";
import { api, type DriverStats, type DailyIncome } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, cardStyle } from "@/lib/theme";
import { fleetNow } from "@/lib/fleet-day";
import { fareLabel } from "@/lib/format";
import { SectionLabel } from "@/components/ui";
import { LoadErrorBanner } from "@/components/status-banner";
import { PeriodNavigator, periodWindow, startOfPeriod, ymd, addDays, mondayOf, weekdayShortNames, type PeriodRange } from "@/components/period-navigator";

/** Map a picked calendar day → range="today" + its day-offset from today. */
function dayOffset(d: Date): number {
  const t0 = startOfPeriod("today", 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return Math.min(0, Math.round((day.getTime() - t0.getTime()) / 86_400_000));
}

const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

export default function StatisticsScreen() {
  const c = useColors();
  const { isOwner } = useAuth();
  const locale = useLocale(); // re-render (and re-label weekdays) on a language switch
  const align = isRTL() ? "right" : "left";
  const [range, setRange] = useState<PeriodRange>("week");
  const [offset, setOffset] = useState(0); // 0 = current period, negative = past
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [daily, setDaily] = useState<DailyIncome[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Which window the shown numbers belong to — never show an old period's
  // figures under a new period's label.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // The current fleet-day. The app can stay open across the 04:00 rollover (or a
  // Monday): re-derive it on focus and on resume so "today"/"this week" move on.
  const [dayKey, setDayKey] = useState(() => ymd(fleetNow()));
  const bumpDay = useCallback(() => {
    const k = ymd(fleetNow());
    setDayKey((prev) => (prev === k ? prev : k));
  }, []);
  useFocusEffect(bumpDay);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") bumpDay();
    });
    return () => sub.remove();
  }, [bumpDay]);

  // The selected window + the Monday of the week its chart shows.
  const { window, weekMon, label, selectedStart } = useMemo(() => {
    const w = periodWindow(range, offset);
    return { window: { from: w.from, to: w.to }, weekMon: w.weekMonday, label: w.label, selectedStart: startOfPeriod(range, offset) };
    // dayKey: recompute when the fleet-day rolls over while the app stays open.
  }, [range, offset, dayKey, locale]);
  const windowKey = `${isOwner ? "o" : "d"}|${window.from}|${window.to}`;

  const seq = useRef(0);
  const load = useCallback(
    async (win: { from: string; to: string }, mon: Date, key: string, silent = false) => {
      const mine = ++seq.current;
      if (!silent) setRefreshing(true); // focus reloads stay quiet; pull-to-refresh spins
      try {
        const wk = { from: ymd(mon), to: ymd(addDays(mon, 6)) };
        const fetchStats = (from: string, to: string) => (isOwner ? api.fleetStats(from, to) : api.stats(from, to));
        // The week view's own response already carries the daily series — one call.
        const sameWindow = range === "week";
        const [s, w] = await Promise.all([
          fetchStats(win.from, win.to),
          sameWindow ? Promise.resolve(null) : fetchStats(wk.from, wk.to),
        ]);
        if (mine !== seq.current) return; // a newer period was picked meanwhile
        setStats(s.data);
        setDaily((w ?? s).data.daily ?? []);
        setLoadedKey(key);
        setLoadError(false);
      } catch {
        if (mine === seq.current) setLoadError(true);
      } finally {
        if (mine === seq.current) setRefreshing(false);
      }
    },
    [isOwner, range],
  );

  useFocusEffect(useCallback(() => { void load(window, weekMon, windowKey, true); }, [load, window, weekMon, windowKey]));
  const current = loadedKey === windowKey ? stats : null;

  const avgPerKm = current && current.km > 0 ? current.earnings / current.km : 0;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
          bumpDay();
          void load(window, weekMon, windowKey);
        }} tintColor={c.ink} />}
      >
        <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", textAlign: align }}>{t("stats.title")}</Text>
        {loadError && <LoadErrorBanner onRetry={() => void load(window, weekMon, windowKey)} />}

        {/* Uber-style range navigator: ‹ [ 24 Aug – 31 Aug ⌄ ] › — the centre pill
            opens the range-type picker (today/week/month); the arrows step the
            period and can't page into the future. */}
        <PeriodNavigator
          label={label}
          range={range}
          selected={selectedStart}
          onRange={(r) => { setRange(r); setOffset(0); }}
          onDate={(d) => { setRange("today"); setOffset(dayOffset(d)); }}
          onPrev={() => setOffset((o) => o - 1)}
          onNext={() => setOffset((o) => Math.min(0, o + 1))}
          canNext={offset < 0}
        />

        {/* Total income hero */}
        <View style={{ ...cardStyle(c), padding: 18, gap: 6 }}>
          <SectionLabel>{t("stats.totalIncome")}</SectionLabel>
          <Text style={{ color: c.ink, fontSize: 36, fontWeight: "700", letterSpacing: -1, textAlign: align, writingDirection: "ltr" }}>
            {current ? fareLabel(null, current.earnings) : "—"}
          </Text>
        </View>

        {/* Income bars for the selected week */}
        <WeeklyChart daily={daily} c={c} monday={weekMon} locale={locale} />

        {/* 2×2 grid */}
        <View style={cardStyle(c)}>
          <View style={{ flexDirection: isRTL() ? "row-reverse" : "row" }}>
            <Cell label={t("stat.offers")} value={current ? String(current.total) : "—"} c={c} border />
            <Cell label={t("stat.accepted")} value={current ? String(current.accepted) : "—"} c={c} />
          </View>
          <View style={{ height: 1, backgroundColor: c.line }} />
          <View style={{ flexDirection: isRTL() ? "row-reverse" : "row" }}>
            <Cell label={t("stats.avgPerKm")} value={current ? fareLabel(null, avgPerKm) : "—"} c={c} border />
            <Cell label={t("stat.km")} value={current ? String(Math.round(current.km)) : "—"} unit={current ? "km" : undefined} c={c} />
          </View>
        </View>

        {/* Inset list: completed + acceptance rate */}
        <View style={cardStyle(c)}>
          <Row label={t("stat.completed")} value={current ? String(current.completed) : "—"} c={c} border />
          <Row label={t("stat.acceptanceRate")} value={current ? `${current.acceptance_rate}%` : "—"} c={c} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type Colors = ReturnType<typeof useColors>;

const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);


/** Income bars for the week starting `monday` (Mon–Sun); future days are dimmed. */
function WeeklyChart({ daily, c, monday, locale }: { daily: DailyIncome[]; c: Colors; monday: Date; locale: string }) {
  const totals = useMemo(() => {
    const byDate = new Map(daily.map((d) => [d.date, d.income]));
    return Array.from({ length: 7 }, (_, i) => byDate.get(ymd(addDays(monday, i))) ?? 0);
  }, [daily, monday]);

  const max = Math.max(...totals, 1);
  const now = fleetNow();
  const letters = useMemo(() => weekdayShortNames(), [locale]);
  const todayIdx = sameDay(mondayOf(now), monday) ? mondayIndex(now) : -1;

  return (
    <View style={{ ...cardStyle(c), padding: 18, gap: 14 }}>
      <SectionLabel>{t("home.week")}</SectionLabel>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: 130, gap: 9 }}>
        {letters.map((wlabel, i) => {
          const date = addDays(monday, i);
          const future = date > now && !sameDay(date, now);
          const isToday = i === todayIdx;
          const h = 8 + (totals[i] / max) * 92;
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", gap: 8, opacity: future ? 0.4 : 1 }}>
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
