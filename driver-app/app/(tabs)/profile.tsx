import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type DriverStats } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, setLocale, getLocale, isRTL } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { Field, PrimaryButton, StatCard, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { fareLabel, distanceLabel } from "@/lib/format";

type SubTab = "stats" | "settings";

export default function ProfileScreen() {
  const c = useColors();
  const { driver } = useAuth();
  const [tab, setTab] = useState<SubTab>("stats");
  const align = isRTL() ? "right" : "left";

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      {/* Identity header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 4 }}>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800", textAlign: align }}>{driver?.name}</Text>
        {driver?.company_name && <Text style={{ color: c.inkMuted, textAlign: align }}>{driver.company_name}</Text>}
      </View>

      {/* Sub-tab switch */}
      <View style={{ flexDirection: "row", gap: 8, padding: 16 }}>
        <SubTabButton label={t("profile.stats")} active={tab === "stats"} onPress={() => setTab("stats")} />
        <SubTabButton label={t("profile.settings")} active={tab === "settings"} onPress={() => setTab("settings")} />
      </View>

      {tab === "stats" ? <StatsTab /> : <SettingsTab />}
    </View>
  );
}

function SubTabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: "center",
        paddingVertical: 10,
        borderRadius: radius.md,
        backgroundColor: active ? c.primary : c.surface2,
      }}
    >
      <Text style={{ color: active ? c.primaryInk : c.inkMuted, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------- Stats tab ------------------------------- */

const RANGES = ["today", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeToDates(range: Range): { from: string; to: string } {
  const today = new Date();
  const to = ymd(today);
  const start = new Date(today);
  if (range === "7d") start.setDate(today.getDate() - 6);
  else if (range === "30d") start.setDate(today.getDate() - 29);
  return { from: ymd(start), to };
}

function StatsTab() {
  const c = useColors();
  const [range, setRange] = useState<Range>("today");
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const { from, to } = rangeToDates(r);
      const res = await api.stats(from, to);
      setStats(res.data);
    } catch {
      /* keep the last figures on transient errors */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {RANGES.map((r) => {
          const active = range === r;
          return (
            <Pressable
              key={r}
              onPress={() => setRange(r)}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 9,
                borderRadius: radius.md,
                backgroundColor: active ? c.primary : c.surface2,
              }}
            >
              <Text style={{ color: active ? c.primaryInk : c.inkMuted, fontWeight: "600" }}>{t(`range.${r}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      {stats && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, opacity: loading ? 0.5 : 1 }}>
          <StatCard label={t("stat.offers")} value={String(stats.total)} />
          <StatCard label={t("stat.accepted")} value={String(stats.accepted)} tone={c.success} />
          <StatCard label={t("stat.declined")} value={String(stats.declined)} tone={c.danger} />
          <StatCard label={t("stat.completed")} value={String(stats.completed)} />
          <StatCard label={t("stat.acceptanceRate")} value={`${Math.round(stats.acceptance_rate)}%`} />
          <StatCard label={t("stat.earnings")} value={fareLabel(null, stats.earnings)} tone={c.accent} />
          <StatCard label={t("stat.km")} value={distanceLabel(stats.km * 1000)} />
        </View>
      )}
    </ScrollView>
  );
}

/* ------------------------------ Settings tab ----------------------------- */

const LANGS: { code: string; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
];

function SettingsTab() {
  const { driver, updateProfile, logout } = useAuth();
  const c = useColors();
  const toast = useToast();
  const [name, setName] = useState(driver?.name ?? "");
  const [password, setPassword] = useState("");
  const [locale, setLocaleState] = useState(getLocale());
  const [saving, setSaving] = useState(false);
  const align = isRTL() ? "right" : "left";

  async function save() {
    setSaving(true);
    try {
      const patch: { name?: string; locale?: string; password?: string } = { name, locale };
      if (password.length >= 8) patch.password = password;
      await updateProfile(patch);
      setPassword("");
      toast.show(t("settings.saved"), "success");
    } catch {
      toast.show(t("settings.saveError"), "error");
    } finally {
      setSaving(false);
    }
  }

  function pickLang(code: string) {
    setLocale(code);
    setLocaleState(code);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
      {driver?.email && (
        <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: c.line }}>
          <Text style={{ color: c.inkSubtle, textAlign: align }}>{driver.email}</Text>
        </View>
      )}

      <SectionTitle>{t("settings.profile")}</SectionTitle>
      <View style={{ gap: 14 }}>
        <Field label={t("settings.name")} value={name} onChangeText={setName} />
        <Field label={t("settings.newPassword")} value={password} onChangeText={setPassword} secureTextEntry />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: align }}>{t("settings.language")}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {LANGS.map((l) => (
            <Pressable
              key={l.code}
              onPress={() => pickLang(l.code)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: radius.md,
                backgroundColor: locale === l.code ? c.primary : c.surface2,
              }}
            >
              <Text style={{ color: locale === l.code ? c.primaryInk : c.inkMuted, fontWeight: "600" }}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <PrimaryButton label={t("settings.save")} onPress={save} loading={saving} />

      <Pressable
        onPress={logout}
        style={{
          flexDirection: isRTL() ? "row-reverse" : "row",
          justifyContent: "center",
          alignItems: "center",
          gap: 8,
          paddingVertical: 14,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.line,
        }}
      >
        <Ionicons name="log-out-outline" size={18} color={c.danger} />
        <Text style={{ color: c.danger, fontWeight: "700" }}>{t("settings.logout")}</Text>
      </Pressable>
    </ScrollView>
  );
}
