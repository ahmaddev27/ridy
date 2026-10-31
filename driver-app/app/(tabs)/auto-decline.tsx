/**
 * Früh abgelehnt / Early decline — the driver's standing decline rules and the
 * history of what those rules declined for them (docs/25).
 *
 * A bottom-nav tab, but ONLY for a driver whose company has the feature: the
 * layout hides the route otherwise, and this screen re-checks `feature_enabled`
 * because a deep link or a flag turned off mid-session must not leave a form
 * that the server answers 403 to.
 *
 * Settings and history are two segments of one page, the way the receipts list
 * keeps its list beside its actions. Money and distance render with Latin digits
 * in every language (`format.ts`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Check } from "@/components/icons";
import { Text, TextInput } from "@/components/typography";
import { SectionLabel, PrimaryButton } from "@/components/ui";
import { PeriodNavigator, periodWindow, startOfPeriod, ymd, type PeriodRange } from "@/components/period-navigator";
import { api, type AutoDeclineConfig, type AutoDeclineRules, type Offer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  RULE_KEYS,
  centsToEuros,
  eurosToCents,
  invalidRules,
  kmToText,
  parseKm,
  setAutoDeclineFeature,
  type AutoDeclineRuleKey,
} from "@/lib/auto-decline";
import { cleanAddress, clockLabel, dateLabel, distanceLabel, fareLabel } from "@/lib/format";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

type Segment = "settings" | "history";
type Row = "row" | "row-reverse";

const PER_PAGE = 20;
const textAlign = () => (isRTL() ? "right" : "left") as "right" | "left";

export default function AutoDeclineScreen() {
  useLocale();
  const c = useColors();
  const { isOwner } = useAuth();
  const [segment, setSegment] = useState<Segment>("settings");
  const [config, setConfig] = useState<AutoDeclineConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const row: Row = isRTL() ? "row-reverse" : "row";

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await api.autoDecline();
      setConfig(r.data);
      setAutoDeclineFeature(r.data.feature_enabled === true);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isOwner) void load();
    }, [load, isOwner]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink, padding: 16, paddingBottom: 8, textAlign: textAlign() }}>
        {t("ad.title")}
      </Text>
      <Segments c={c} row={row} value={segment} onChange={setSegment} />
      {isOwner ? (
        <Notice c={c} title={t("ad.ownerTitle")} body={t("ad.ownerBody")} />
      ) : failed ? (
        <Notice c={c} title={t("ad.loadFailed")} body={t("ad.loadFailedBody")} tone="danger" />
      ) : config === null ? (
        <View style={{ paddingVertical: 32, alignItems: "center" }}>
          <ActivityIndicator color={c.ink} />
        </View>
      ) : !config.feature_enabled ? (
        <Notice c={c} title={t("ad.unavailable")} body={t("ad.unavailableBody")} />
      ) : segment === "settings" ? (
        <SettingsPane c={c} row={row} config={config} onSaved={setConfig} />
      ) : (
        <HistoryPane c={c} row={row} />
      )}
    </SafeAreaView>
  );
}

function Notice({ c, title, body, tone }: { c: Palette; title: string; body: string; tone?: "danger" }) {
  return (
    <View style={{ ...cardStyle(c), padding: 16, margin: 16, gap: 6 }}>
      <Text style={{ color: tone === "danger" ? c.danger : c.ink, fontWeight: "700", fontSize: 14.5 }}>{title}</Text>
      <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{body}</Text>
    </View>
  );
}

function Segments({ c, row, value, onChange }: { c: Palette; row: Row; value: Segment; onChange: (s: Segment) => void }) {
  return (
    <View style={{ flexDirection: row, gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
      {(["settings", "history"] as const).map((s) => (
        <Chip key={s} c={c} label={t(`ad.seg.${s}`)} active={value === s} onPress={() => onChange(s)} />
      ))}
    </View>
  );
}

function Chip({ c, label, active, onPress }: { c: Palette; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radius.pill,
        backgroundColor: active ? c.primary : c.surface2,
      }}
    >
      <Text style={{ color: active ? c.primaryInk : c.ink, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------ Settings ------------------------------ */

/** Text drafts of the two numeric inputs, so a half-typed "9," is never rejected. */
type Drafts = Record<"min_fare" | "max_pickup_distance" | "max_trip_distance", string>;

function draftsOf(rules: AutoDeclineRules): Drafts {
  const v = rules.min_fare.value_e2;
  const km = (n: number) => (n > 0 ? kmToText(n) : "");
  return {
    min_fare: v > 0 ? centsToEuros(v) : "",
    max_pickup_distance: km(rules.max_pickup_distance.km),
    max_trip_distance: km(rules.max_trip_distance.km),
  };
}

/** Fold the typed drafts back into the rules; an unparsable draft counts as 0. */
function withDrafts(rules: AutoDeclineRules, d: Drafts): AutoDeclineRules {
  return {
    ...rules,
    min_fare: { ...rules.min_fare, value_e2: eurosToCents(d.min_fare) ?? 0 },
    max_pickup_distance: { ...rules.max_pickup_distance, km: parseKm(d.max_pickup_distance) ?? 0 },
    max_trip_distance: { ...rules.max_trip_distance, km: parseKm(d.max_trip_distance) ?? 0 },
  };
}

function SettingsPane({
  c,
  row,
  config,
  onSaved,
}: {
  c: Palette;
  row: Row;
  config: AutoDeclineConfig;
  onSaved: (next: AutoDeclineConfig) => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [rules, setRules] = useState(config.rules);
  const [drafts, setDrafts] = useState(() => draftsOf(config.rules));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [invalid, setInvalid] = useState<AutoDeclineRuleKey[]>([]);

  const patch = <K extends AutoDeclineRuleKey>(key: K, part: Partial<AutoDeclineRules[K]>) => {
    setStatus("idle");
    setRules((prev) => ({ ...prev, [key]: { ...prev[key], ...part } }));
  };

  const save = async () => {
    const next = withDrafts(rules, drafts);
    const bad = invalidRules(next);
    setInvalid(bad);
    if (bad.length > 0) return;
    setSaving(true);
    try {
      const r = await api.saveAutoDecline({ enabled, rules: next });
      onSaved(r.data);
      setRules(r.data.rules);
      setStatus("saved");
    } catch {
      setStatus("failed");
    } finally {
      setSaving(false);
    }
  };

  const draft = (key: keyof Drafts) => (text: string) => {
    setStatus("idle");
    setDrafts((p) => ({ ...p, [key]: text }));
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <View style={{ ...cardStyle(c), padding: 14, gap: 6 }}>
        <ToggleRow c={c} row={row} label={t("ad.master")} value={enabled} onChange={(v) => { setStatus("idle"); setEnabled(v); }} />
        <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: textAlign() }}>{t("ad.masterHint")}</Text>
      </View>

      <SectionLabel>{t("ad.rules")}</SectionLabel>

      <RuleCard c={c} row={row} title={t("ad.rule.min_fare")} on={rules.min_fare.enabled} bad={invalid.includes("min_fare")}
        onToggle={(v) => patch("min_fare", { enabled: v })}>
        <NumberInput c={c} unit="€" value={drafts.min_fare} onChange={draft("min_fare")} placeholder="9,00" />
      </RuleCard>

      <RuleCard c={c} row={row} title={t("ad.rule.reject_cities")} on={rules.reject_cities.enabled} bad={invalid.includes("reject_cities")}
        onToggle={(v) => patch("reject_cities", { enabled: v })}>
        <CityPicker c={c} row={row} options={config.available_cities} selected={rules.reject_cities.cities}
          onChange={(cities) => patch("reject_cities", { cities })} />
      </RuleCard>

      <RuleCard c={c} row={row} title={t("ad.rule.max_pickup_distance")} on={rules.max_pickup_distance.enabled} bad={invalid.includes("max_pickup_distance")}
        onToggle={(v) => patch("max_pickup_distance", { enabled: v })}>
        <NumberInput c={c} unit="km" value={drafts.max_pickup_distance} onChange={draft("max_pickup_distance")} placeholder="8" />
      </RuleCard>

      <RuleCard c={c} row={row} title={t("ad.rule.max_trip_distance")} on={rules.max_trip_distance.enabled} bad={invalid.includes("max_trip_distance")}
        onToggle={(v) => patch("max_trip_distance", { enabled: v })}>
        <NumberInput c={c} unit="km" value={drafts.max_trip_distance} onChange={draft("max_trip_distance")} placeholder="40" />
      </RuleCard>

      {invalid.length > 0 && <Text style={{ color: c.danger, fontSize: 13, textAlign: textAlign() }}>{t("ad.needValue")}</Text>}
      {status === "failed" && <Text style={{ color: c.danger, fontSize: 13, textAlign: textAlign() }}>{t("ad.saveFailed")}</Text>}
      {status === "saved" && <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: textAlign() }}>{t("ad.saved")}</Text>}

      <PrimaryButton label={t("ad.save")} onPress={() => void save()} loading={saving} />
    </ScrollView>
  );
}

function ToggleRow({ c, row, label, value, onChange }: { c: Palette; row: Row; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5, flexShrink: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

function RuleCard({
  c,
  row,
  title,
  on,
  bad,
  onToggle,
  children,
}: {
  c: Palette;
  row: Row;
  title: string;
  on: boolean;
  bad: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ ...cardStyle(c), padding: 14, gap: 10, borderColor: bad ? c.danger : undefined }}>
      <ToggleRow c={c} row={row} label={title} value={on} onChange={onToggle} />
      {on && children}
    </View>
  );
}

function NumberInput({ c, unit, value, onChange, placeholder }: { c: Palette; unit: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const rtl = isRTL();
  return (
    <View
      style={{
        flexDirection: rtl ? "row-reverse" : "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: c.surface2,
        borderRadius: radius.lg,
        paddingHorizontal: 14,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={c.inkSubtle}
        // Numbers read left to right even in Arabic, with Latin digits.
        style={{ flex: 1, color: c.ink, fontSize: 16, paddingVertical: 10, textAlign: rtl ? "right" : "left", writingDirection: "ltr" }}
      />
      <Text style={{ color: c.inkMuted, fontWeight: "700" }}>{unit}</Text>
    </View>
  );
}

function CityPicker({ c, row, options, selected, onChange }: { c: Palette; row: Row; options: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  // A city already chosen but no longer in the recent-offers sample must stay visible.
  const all = useMemo(() => Array.from(new Set([...options, ...selected])).sort((a, b) => a.localeCompare(b)), [options, selected]);
  const toggle = (city: string) =>
    onChange(selected.includes(city) ? selected.filter((x) => x !== city) : [...selected, city]);

  if (all.length === 0) return <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: textAlign() }}>{t("ad.noCities")}</Text>;
  return (
    <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
      {all.map((city) => {
        const on = selected.includes(city);
        return (
          <Pressable
            key={city}
            onPress={() => toggle(city)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={{
              flexDirection: row,
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: radius.pill,
              backgroundColor: on ? c.primary : c.surface2,
            }}
          >
            {on && <Check size={14} color={c.primaryInk} strokeWidth={2.6} />}
            <Text style={{ color: on ? c.primaryInk : c.ink, fontSize: 13, fontWeight: "600" }}>{city}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------ History ------------------------------ */

function HistoryPane({ c, row }: { c: Palette; row: Row }) {
  const [reason, setReason] = useState<AutoDeclineRuleKey | null>(null);
  const [range, setRange] = useState<PeriodRange>("month");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Offer[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const win = periodWindow(range, offset);
  const start = startOfPeriod(range, offset);

  const fetchPage = useCallback(
    async (target: number) => {
      const mine = ++seq.current;
      const w = periodWindow(range, offset);
      const r = await api.autoDeclineHistory({ reason: reason ?? undefined, from: w.from, to: w.to, page: target, per_page: PER_PAGE });
      if (mine !== seq.current) return; // a newer filter superseded this answer
      setRows((prev) => (target === 1 ? r.data : [...(prev ?? []), ...r.data]));
      setPage(target);
      setHasMore(r.meta.current_page < r.meta.last_page);
    },
    [range, offset, reason],
  );

  const reload = useCallback(async () => {
    setFailed(false);
    try {
      await fetchPage(1);
    } catch {
      setFailed(true);
      setRows(null);
    }
  }, [fetchPage]);

  useEffect(() => {
    setRows(null);
    void reload();
  }, [reload]);

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchPage(page + 1);
    } catch {
      // The rows already shown stay; the button is still there to retry.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ink} />}
    >
      <PeriodNavigator
        label={win.label}
        range={range}
        selected={start}
        onRange={(r) => { setRange(r); setOffset(0); }}
        onDate={(d) => { setRange("today"); setOffset(dayOffset(d)); }}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => setOffset((o) => Math.min(0, o + 1))}
        canNext={offset < 0}
      />
      <ReasonFilter c={c} row={row} value={reason} onChange={setReason} />

      {rows === null && !failed && <ActivityIndicator color={c.ink} style={{ paddingVertical: 24 }} />}
      {failed && <Notice c={c} title={t("ad.loadFailed")} body={t("ad.loadFailedBody")} tone="danger" />}
      {rows !== null && rows.length === 0 && <Notice c={c} title={t("ad.historyEmpty")} body={t("ad.historyEmptyBody")} />}
      {rows?.map((o) => <DeclinedRow key={o.id} c={c} row={row} offer={o} />)}

      {hasMore && (
        <Pressable onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button" style={{ ...cardStyle(c), padding: 14, alignItems: "center" }}>
          {loadingMore ? <ActivityIndicator color={c.ink} /> : <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14 }}>{t("subs.loadMore")}</Text>}
        </Pressable>
      )}
    </ScrollView>
  );
}

/** Whole fleet-days from today to `d` (<= 0), the offset the period navigator speaks. */
function dayOffset(d: Date): number {
  const today = startOfPeriod("today", 0);
  return Math.round((new Date(ymd(d)).getTime() - new Date(ymd(today)).getTime()) / 86_400_000);
}

function ReasonFilter({ c, row, value, onChange }: { c: Palette; row: Row; value: AutoDeclineRuleKey | null; onChange: (v: AutoDeclineRuleKey | null) => void }) {
  return (
    <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
      <Chip c={c} label={t("ad.reason.all")} active={value === null} onPress={() => onChange(null)} />
      {RULE_KEYS.map((k) => (
        <Chip key={k} c={c} label={t(`ad.reason.${k}`)} active={value === k} onPress={() => onChange(k)} />
      ))}
    </View>
  );
}

function DeclinedRow({ c, row, offer }: { c: Palette; row: Row; offer: Offer }) {
  const when = offer.dispatch_rejected_at ?? offer.received_at;
  const reason = offer.auto_decline_reason ? t(`ad.reason.${offer.auto_decline_reason}`) : null;
  return (
    <View style={{ ...cardStyle(c), padding: 14, gap: 6 }}>
      <View style={{ flexDirection: row, justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <Text style={{ color: c.ink, fontWeight: "700", fontSize: 15 }}>
          {fareLabel(offer.fare_formatted, offer.fare_amount)}
          {offer.distance_m ? ` · ${distanceLabel(offer.distance_m)}` : ""}
        </Text>
        {reason && (
          <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.surface2 }}>
            <Text style={{ color: c.inkMuted, fontWeight: "700", fontSize: 11.5 }}>{reason}</Text>
          </View>
        )}
      </View>
      <Text style={{ color: c.inkMuted, fontSize: 13.5, textAlign: textAlign() }} numberOfLines={1}>
        {cleanAddress(offer.pickup_station_name ?? offer.pickup_address)}
      </Text>
      <Text style={{ color: c.inkMuted, fontSize: 13.5, textAlign: textAlign() }} numberOfLines={1}>
        {"→ "}
        {cleanAddress(offer.dropoff_station_name ?? offer.dropoff_address)}
      </Text>
      <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: textAlign() }}>
        {dateLabel(when)} · {clockLabel(when)}
      </Text>
    </View>
  );
}
