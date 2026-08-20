import { useEffect, useState } from "react";
import { View, ScrollView, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ChevronLeft, ChevronRight, Globe, Bell, Volume2, Vibrate, MessageCircle, LogOut, type LucideIcon } from "lucide-react-native";
import { Text } from "@/components/typography";
import { SectionLabel, Field, PrimaryButton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, radius, cardStyle, setThemeMode, useThemeMode, type Palette } from "@/lib/theme";

const LANG_NAMES: Record<string, string> = { de: "Deutsch", en: "English", ar: "العربية" };

/** SecureStore keys for the three persisted preference toggles. */
const PREF_KEYS = { notifications: "pref.notifications", sound: "pref.sound", haptic: "pref.haptic" } as const;
type PrefState = { notifications: boolean; sound: boolean; haptic: boolean };
const DEFAULT_PREFS: PrefState = { notifications: true, sound: true, haptic: true };

const SUPPORT_EMAIL = "support@reidey.de";

export default function SettingsScreen() {
  const c = useColors();
  const themeMode = useThemeMode();
  const router = useRouter();
  const locale = useLocale();
  const { driver, updateProfile, logout } = useAuth();
  const toast = useToast();
  const align = isRTL() ? "right" : "left";
  const Chevron = isRTL() ? ChevronLeft : ChevronRight;

  const [prefs, setPrefs] = useState<PrefState>(DEFAULT_PREFS);
  const [name, setName] = useState(driver?.name ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [n, s, h] = await Promise.all([
          SecureStore.getItemAsync(PREF_KEYS.notifications),
          SecureStore.getItemAsync(PREF_KEYS.sound),
          SecureStore.getItemAsync(PREF_KEYS.haptic),
        ]);
        if (!alive) return;
        setPrefs({
          notifications: n === null ? true : n === "1",
          sound: s === null ? true : s === "1",
          haptic: h === null ? true : h === "1",
        });
      } catch {
        /* keep defaults */
      }
    })();
    return () => { alive = false; };
  }, []);

  const setPref = (key: keyof PrefState, storeKey: string) => (value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    SecureStore.setItemAsync(storeKey, value ? "1" : "0").catch(() => {});
  };

  // Owners are read-only monitors; only real drivers can edit their profile.
  const canEdit = !driver?.is_owner;
  const dirty = name.trim() !== (driver?.name ?? "") || password.length > 0;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const patch: { name?: string; password?: string } = {};
      if (name.trim() && name.trim() !== driver?.name) patch.name = name.trim();
      if (password.length >= 6) patch.password = password;
      await updateProfile(patch);
      setPassword("");
      toast.show(t("settings.saved"), "success");
    } catch {
      toast.show(t("settings.saveError"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      {/* Header */}
      <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
          {isRTL() ? <ChevronRight size={24} color={c.ink} /> : <ChevronLeft size={24} color={c.ink} />}
        </Pressable>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800", textAlign: align }}>{t("settings.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 22 }} keyboardShouldPersistTaps="handled">
        {/* PREFERENCES */}
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("settings.preferences")}</SectionLabel>
          <View style={cardStyle(c)}>
            <NavRow icon={Globe} label={t("settings.language")} value={LANG_NAMES[locale] ?? locale} onPress={() => router.push("/language")} c={c} Chevron={Chevron} border />
            <ToggleRow icon={Bell} label={t("settings.offerNotifications")} value={prefs.notifications} onChange={setPref("notifications", PREF_KEYS.notifications)} c={c} border />
            <ToggleRow icon={Volume2} label={t("settings.sound")} value={prefs.sound} onChange={setPref("sound", PREF_KEYS.sound)} c={c} border />
            <ToggleRow icon={Vibrate} label={t("settings.haptic")} value={prefs.haptic} onChange={setPref("haptic", PREF_KEYS.haptic)} c={c} />
          </View>
        </View>

        {/* APPEARANCE — light / dark / follow system */}
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("settings.appearance")}</SectionLabel>
          <View style={{ ...cardStyle(c), flexDirection: isRTL() ? "row-reverse" : "row", padding: 4, gap: 4 }}>
            {(["system", "light", "dark"] as const).map((m) => {
              const on = themeMode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    setThemeMode(m);
                    SecureStore.setItemAsync("theme", m).catch(() => {});
                  }}
                  style={{ flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: radius.control, backgroundColor: on ? c.primary : "transparent" }}
                >
                  <Text style={{ color: on ? c.primaryInk : c.inkMuted, fontSize: 13.5, fontWeight: "600" }}>
                    {t(`settings.theme${m === "system" ? "System" : m === "light" ? "Light" : "Dark"}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ACCOUNT — real, editable profile (name + password) via updateProfile. */}
        {canEdit && (
          <View style={{ gap: 10 }}>
            <SectionLabel>{t("settings.account")}</SectionLabel>
            <View style={{ gap: 10 }}>
              <Field label={t("settings.name")} value={name} onChangeText={setName} autoCapitalize="words" />
              <Field label={t("settings.newPassword")} value={password} onChangeText={setPassword} secure autoCapitalize="none" />
              <PrimaryButton label={t("settings.save")} onPress={save} loading={saving} disabled={!dirty} />
            </View>
          </View>
        )}

        {/* SUPPORT — a real mailto action. */}
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("settings.support")}</SectionLabel>
          <View style={cardStyle(c)}>
            <NavRow
              icon={MessageCircle}
              label={t("settings.contactSupport")}
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {})}
              c={c}
              Chevron={Chevron}
            />
          </View>
        </View>

        {/* Log out */}
        <Pressable
          onPress={() => logout()}
          style={{ ...cardStyle(c), flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 }}
        >
          <LogOut size={18} color={c.danger} strokeWidth={1.8} />
          <Text style={{ color: c.danger, fontSize: 15, fontWeight: "700" }}>{t("settings.logout")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function RowLead({ icon: Icon, label, value, c }: { icon: LucideIcon; label: string; value?: string; c: Palette }) {
  return (
    <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 12, flex: 1 }}>
      <Icon size={19} color={c.inkMuted} strokeWidth={1.6} />
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "500", textAlign: isRTL() ? "right" : "left" }}>{label}</Text>
    </View>
  );
}

function NavRow({ icon, label, value, onPress, c, Chevron, border }: { icon: LucideIcon; label: string; value?: string; onPress: () => void; c: Palette; Chevron: LucideIcon; border?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <RowLead icon={icon} label={label} c={c} />
      {value ? <Text style={{ color: c.inkSubtle, fontSize: 14, fontWeight: "500" }}>{value}</Text> : null}
      <Chevron size={18} color={c.inkFaint} strokeWidth={1.6} />
    </Pressable>
  );
}

function ToggleRow({ icon, label, value, onChange, c, border }: { icon: LucideIcon; label: string; value: boolean; onChange: (v: boolean) => void; c: Palette; border?: boolean }) {
  return (
    <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <RowLead icon={icon} label={label} c={c} />
      <Toggle value={value} onChange={onChange} c={c} />
    </View>
  );
}

function Toggle({ value, onChange, c }: { value: boolean; onChange: (v: boolean) => void; c: Palette }) {
  const start = isRTL() ? "flex-end" : "flex-start";
  const end = isRTL() ? "flex-start" : "flex-end";
  return (
    <Pressable onPress={() => onChange(!value)} hitSlop={6} style={{ width: 42, height: 25, borderRadius: radius.pill, backgroundColor: value ? c.primary : c.surface2, justifyContent: "center", alignItems: value ? end : start, paddingHorizontal: 3 }}>
      <View style={{ width: 19, height: 19, borderRadius: radius.pill, backgroundColor: value ? c.primaryInk : c.inkFaint }} />
    </Pressable>
  );
}
