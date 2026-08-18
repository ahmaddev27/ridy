import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { Ionicons } from "@expo/vector-icons";
import { api, type DriverStats } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL, setLocale, getLocale } from "@/lib/i18n";
import { useColors, radius, cardStyle } from "@/lib/theme";
import { fareLabel } from "@/lib/format";
import { Field, PrimaryButton, SectionLabel } from "@/components/ui";
import { useToast } from "@/components/toast";

const RANGES = [
  { key: "today", days: 0 },
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
] as const;

const LANGS = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
];

export default function ProfileScreen() {
  const c = useColors();
  const [tab, setTab] = useState<"stats" | "settings">("stats");
  const align = isRTL() ? "right" : "left";

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 18 }}>
        <Text style={{ color: c.ink, fontSize: 26, fontWeight: "800", textAlign: align }}>{t("tabs.profile")}</Text>

        {/* Segment */}
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", backgroundColor: c.surface2, borderRadius: radius.lg, padding: 5 }}>
          {(["stats", "settings"] as const).map((s) => {
            const on = tab === s;
            return (
              <Pressable key={s} onPress={() => setTab(s)} style={{ flex: 1, paddingVertical: 11, borderRadius: radius.md, backgroundColor: on ? c.surface : "transparent", alignItems: "center", ...(on ? { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}) }}>
                <Text style={{ color: on ? c.ink : c.inkMuted, fontWeight: "700", fontSize: 16 }}>{t(s === "stats" ? "profile.stats" : "profile.settings")}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === "stats" ? <Stats /> : <Settings />}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stats() {
  const c = useColors();
  const { isOwner } = useAuth();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("today");
  const [data, setData] = useState<DriverStats | null>(null);
  const align = isRTL() ? "right" : "left";

  const load = useCallback(async (r: (typeof RANGES)[number]) => {
    try {
      const from = r.days === 0 ? new Date().toISOString().slice(0, 10) : new Date(Date.now() - r.days * 864e5).toISOString().slice(0, 10);
      setData((await (isOwner ? api.fleetStats(from) : api.stats(from))).data);
    } catch { /* */ }
  }, [isOwner]);

  useEffect(() => { const r = RANGES.find((x) => x.key === range)!; load(r); }, [range, load]);

  const accepted = data?.accepted ?? 0;
  const declined = data?.declined ?? 0;
  const rate = data?.acceptance_rate ?? 0;

  return (
    <View style={{ gap: 16 }}>
      {/* Range chips */}
      <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", gap: 10 }}>
        {RANGES.map((r) => {
          const on = range === r.key;
          return (
            <Pressable key={r.key} onPress={() => setRange(r.key)} style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.line }}>
              <Text style={{ color: on ? c.primaryInk : c.inkMuted, fontWeight: "700", fontSize: 14 }}>{t(`range.${r.key}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Earnings */}
      <View style={{ ...cardStyle(c), padding: 20, gap: 6 }}>
        <SectionLabel>{t("profile.verdienstToday")}</SectionLabel>
        <Text style={{ color: c.ink, fontSize: 38, fontWeight: "800", letterSpacing: -1, textAlign: align }}>{fareLabel(null, data?.earnings ?? 0)}</Text>
      </View>

      {/* Grid */}
      <View style={cardStyle(c)}>
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row" }}>
          <GridCell label={t("home.st.offers")} value={String(data?.total ?? 0)} border />
          <GridCell label={t("stat.accepted")} value={String(accepted)} />
        </View>
        <View style={{ height: 1, backgroundColor: c.line }} />
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row" }}>
          <GridCell label={t("stat.completed")} value={String(data?.completed ?? 0)} border />
          <GridCell label={t("home.st.distance")} value={String(data?.km ?? 0)} unit="km" />
        </View>
      </View>

      {/* Acceptance */}
      <View style={{ ...cardStyle(c), padding: 18, gap: 12 }}>
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>{t("stat.acceptanceRate")}</Text>
          <Text style={{ color: c.ink, fontSize: 22, fontWeight: "800" }}>{rate}%</Text>
        </View>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: c.surface2, overflow: "hidden" }}>
          <View style={{ height: "100%", width: `${rate}%`, backgroundColor: c.completed }} />
        </View>
        <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", justifyContent: "space-between" }}>
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("profile.accepted").replace("{n}", String(accepted))}</Text>
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("profile.declined").replace("{n}", String(declined))}</Text>
        </View>
      </View>
    </View>
  );
}

function GridCell({ label, value, unit, border }: { label: string; value: string; unit?: string; border?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, padding: 16, gap: 5, borderRightWidth: border && !isRTL() ? 1 : 0, borderLeftWidth: border && isRTL() ? 1 : 0, borderColor: c.line }}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ color: c.ink, fontSize: 22, fontWeight: "800", textAlign: isRTL() ? "right" : "left" }}>
        {value}{unit ? <Text style={{ fontSize: 14, color: c.inkMuted }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function Settings() {
  const c = useColors();
  const { driver, isOwner, updateProfile, logout } = useAuth();
  const toast = useToast();
  const [locale, setLocaleState] = useState(getLocale());
  const [edit, setEdit] = useState<null | "name" | "password">(null);
  const [name, setName] = useState(driver?.name ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const align = isRTL() ? "right" : "left";
  const initials = (driver?.name ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  function cycleLang() {
    const i = LANGS.findIndex((l) => l.code === locale);
    const next = LANGS[(i + 1) % LANGS.length];
    setLocale(next.code);
    setLocaleState(next.code);
    // Owners have no editable driver profile; keep the language change local.
    if (!isOwner) updateProfile({ locale: next.code }).catch(() => {});
  }

  async function save() {
    setSaving(true);
    try {
      const patch: { name?: string; password?: string } = {};
      if (edit === "name") patch.name = name;
      if (edit === "password" && password.length >= 8) patch.password = password;
      await updateProfile(patch);
      toast.show(t("settings.saved"));
      setEdit(null); setPassword("");
    } catch {
      toast.show(t("settings.saveError"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 18 }}>
      {/* Identity */}
      <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 16, ...cardStyle(c), padding: 18 }}>
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: c.inkMuted, fontSize: 20, fontWeight: "700" }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800", textAlign: align }}>{driver?.name}</Text>
          {driver?.company_name && <Text style={{ color: c.inkMuted, fontSize: 15, textAlign: align }}>{driver.company_name}</Text>}
          {driver?.email && <Text style={{ color: c.inkSubtle, fontSize: 14, textAlign: align }}>{driver.email}</Text>}
        </View>
      </View>

      {/* KONTO */}
      <SectionLabel>{t("profile.konto")}</SectionLabel>
      <View style={cardStyle(c)}>
        {/* Owners monitor read-only; name/password are managed in the dashboard. */}
        {!isOwner && (
          <>
            <Row label={t("settings.name")} value={driver?.name ?? ""} onPress={() => { setName(driver?.name ?? ""); setEdit("name"); }} />
            <Divider />
          </>
        )}
        <Row label={t("settings.language")} value={LANGS.find((l) => l.code === locale)?.label ?? ""} onPress={cycleLang} last={isOwner} />
        {!isOwner && (
          <>
            <Divider />
            <Row label={t("settings.newPassword").replace(" (optional)", "").replace(" (اختياري)", "").replace(" (optional)", "")} onPress={() => { setPassword(""); setEdit("password"); }} last />
          </>
        )}
      </View>

      {/* Logout */}
      <Pressable onPress={logout} style={{ flexDirection: isRTL() ? "row-reverse" : "row", gap: 8, ...cardStyle(c), paddingVertical: 16, alignItems: "center", justifyContent: "center", marginTop: 6 }}>
        <Ionicons name="log-out-outline" size={18} color={c.danger} />
        <Text style={{ color: c.danger, fontSize: 15, fontWeight: "700" }}>{t("settings.logout")}</Text>
      </Pressable>
      <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: "center" }}>Reidey Driver 1.0.0</Text>

      {/* Edit modal */}
      <Modal visible={edit !== null} transparent animationType="fade" onRequestClose={() => setEdit(null)}>
        <Pressable onPress={() => setEdit(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: c.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 16 }}>
            <Text style={{ color: c.ink, fontSize: 18, fontWeight: "800", textAlign: align }}>{edit === "name" ? t("settings.name") : t("settings.newPassword")}</Text>
            {edit === "name" ? (
              <Field label={t("settings.name")} value={name} onChangeText={setName} />
            ) : (
              <Field label={t("settings.newPassword")} value={password} onChangeText={setPassword} secure />
            )}
            <PrimaryButton label={t("settings.save")} onPress={save} loading={saving} icon="save-outline" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Row({ label, value, onPress, last }: { label: string; value?: string; onPress: () => void; last?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 17 }}>
      <Text style={{ flex: 1, color: c.ink, fontSize: 17, textAlign: isRTL() ? "right" : "left" }}>{label}</Text>
      {value ? <Text style={{ color: c.inkMuted, fontSize: 16 }} numberOfLines={1}>{value}</Text> : null}
      <Ionicons name={isRTL() ? "chevron-back" : "chevron-forward"} size={18} color={c.inkSubtle} />
    </Pressable>
  );
}

function Divider() {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 18 }} />;
}
