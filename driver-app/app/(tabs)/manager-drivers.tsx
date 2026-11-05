/**
 * Manager: Früh abgelehnt – Fahrer.
 *
 * A manager is also a driver, so this is one extra tab, not a separate mode. It
 * mirrors the dashboard's Early-decline admin panel: the manager decides WHO may
 * use Early decline (`admin_enabled`); the rules themselves stay the driver's
 * own and are shown read-only. The server answers 404 for another company's
 * driver and 403 when the company's dispatch_reject flag is off, so the screen
 * degrades to a hint instead of a toggle that cannot work.
 */
import { useCallback, useState } from "react";
import { View, ScrollView, RefreshControl, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Text } from "@/components/typography";
import { api, type AutoDeclineRules, type ManagerAutoDeclineDriver } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { centsToEuros } from "@/lib/auto-decline";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, cardStyle, type Palette } from "@/lib/theme";

const textAlign = () => (isRTL() ? "right" : "left") as "right" | "left";

/** "Mindestpreis 8,00 € und 1,20 € pro km" (Latin digits in every language). */
function ruleSummary(rules: Partial<AutoDeclineRules> | null | undefined): string {
  const parts: string[] = [];
  const fare = rules?.min_fare;
  const km = rules?.min_price_per_km;
  if (fare?.enabled) parts.push(`${t("mgr.minFare")} ${centsToEuros(fare.value_e2)} €`);
  if (km?.enabled) parts.push(`${centsToEuros(km.value_e2)} € ${t("mgr.perKm")}`);
  if (parts.length === 2) return parts.join(` ${t(km?.mode === "or" ? "mgr.or" : "mgr.and")} `);
  return parts[0] ?? t("mgr.noRules");
}

export default function ManagerDriversScreen() {
  useLocale();
  const c = useColors();
  const { isManager } = useAuth();
  const [drivers, setDrivers] = useState<ManagerAutoDeclineDriver[] | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [pending, setPending] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await api.managerAutoDeclineDrivers();
      setDrivers(r.drivers ?? []);
      setFeatureEnabled(r.feature_enabled !== false);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isManager) void load();
    }, [load, isManager]),
  );

  const toggle = useCallback(async (driver: ManagerAutoDeclineDriver, next: boolean) => {
    setSaveFailed(false);
    setPending((p) => new Set(p).add(driver.id));
    setDrivers((rows) => rows?.map((d) => (d.id === driver.id ? { ...d, admin_enabled: next } : d)) ?? rows);
    try {
      await api.setManagerDriverAdmin(driver.id, next);
    } catch {
      setSaveFailed(true);
      setDrivers((rows) => rows?.map((d) => (d.id === driver.id ? { ...d, admin_enabled: !next } : d)) ?? rows);
    } finally {
      setPending((p) => {
        const copy = new Set(p);
        copy.delete(driver.id);
        return copy;
      });
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink, textAlign: textAlign() }}>{t("mgr.title")}</Text>
        <Text style={{ fontSize: 13.5, color: c.inkMuted, textAlign: textAlign() }}>{t("mgr.hint")}</Text>
        {saveFailed ? <Text style={{ color: c.danger, fontSize: 13, textAlign: textAlign() }}>{t("mgr.saveFailed")}</Text> : null}
        <Body
          c={c}
          drivers={drivers}
          failed={failed}
          featureEnabled={featureEnabled}
          pending={pending}
          onToggle={toggle}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

type BodyProps = {
  c: Palette;
  drivers: ManagerAutoDeclineDriver[] | null;
  failed: boolean;
  featureEnabled: boolean;
  pending: Set<number>;
  onToggle: (d: ManagerAutoDeclineDriver, next: boolean) => void;
};

function Body({ c, drivers, failed, featureEnabled, pending, onToggle }: BodyProps) {
  if (failed) return <Notice c={c} title={t("mgr.loadFailed")} body={t("mgr.loadFailedBody")} danger />;
  if (drivers === null) return <ActivityIndicator color={c.accent} style={{ marginTop: 32 }} />;
  if (!featureEnabled) return <Notice c={c} title={t("tabs.manager")} body={t("mgr.featureOff")} />;
  if (drivers.length === 0) return <Notice c={c} title={t("mgr.empty")} body="" />;
  return (
    <>
      {drivers.map((d) => (
        <DriverRow key={d.id} c={c} driver={d} busy={pending.has(d.id)} onToggle={onToggle} />
      ))}
    </>
  );
}

function Notice({ c, title, body, danger }: { c: Palette; title: string; body: string; danger?: boolean }) {
  return (
    <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
      <Text style={{ color: danger ? c.danger : c.ink, fontWeight: "700", fontSize: 14.5, textAlign: textAlign() }}>{title}</Text>
      {body ? <Text style={{ color: c.inkMuted, fontSize: 13.5, textAlign: textAlign() }}>{body}</Text> : null}
    </View>
  );
}

type RowProps = { c: Palette; driver: ManagerAutoDeclineDriver; busy: boolean; onToggle: BodyProps["onToggle"] };

function DriverRow({ c, driver, busy, onToggle }: RowProps) {
  const row = isRTL() ? "row-reverse" : "row";
  const state = driver.admin_enabled
    ? driver.enabled
      ? t("mgr.driverOn")
      : t("mgr.driverOff")
    : t("mgr.blocked");
  return (
    <View style={{ ...cardStyle(c), padding: 14, gap: 6 }}>
      <View style={{ flexDirection: row, alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontWeight: "700", fontSize: 15, textAlign: textAlign() }}>{driver.name}</Text>
          <Text style={{ color: driver.admin_enabled && driver.enabled ? c.accent : c.inkMuted, fontSize: 12.5, textAlign: textAlign() }}>
            {state}
          </Text>
        </View>
        <Switch
          value={driver.admin_enabled}
          disabled={busy}
          onValueChange={(next) => onToggle(driver, next)}
          accessibilityLabel={`${driver.name}: ${driver.admin_enabled ? t("mgr.allowed") : t("mgr.blocked")}`}
        />
      </View>
      <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: textAlign() }}>{ruleSummary(driver.rules)}</Text>
    </View>
  );
}
