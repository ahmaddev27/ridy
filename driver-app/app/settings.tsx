import { useEffect, useState } from "react";
import { View, ScrollView, Pressable, Linking, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Bell,
  BellOff,
  Volume2,
  Vibrate,
  MessageCircle,
  LogOut,
  ShieldCheck,
  FileText,
  Trash2,
  BatteryWarning,
  type LucideIcon,
} from "@/components/icons";
import { Text } from "@/components/typography";
import { SectionLabel, Field, PrimaryButton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, radius, cardStyle, setThemeMode, useThemeMode, type Palette } from "@/lib/theme";
import { loadPrefs, setPref as storePref, type PrefName, type Prefs } from "@/lib/prefs";
import { usePushHealth } from "@/lib/use-push-health";
import { PRIVACY_URL, IMPRINT_URL, SUPPORT_EMAIL } from "@/lib/links";

const LANG_NAMES: Record<string, string> = { de: "Deutsch", en: "English", ar: "العربية" };

const DEFAULT_PREFS: Prefs = { notifications: true, sound: true, haptic: true };

const openUrl = (url: string) => Linking.openURL(url).catch(() => {});

export default function SettingsScreen() {
  const c = useColors();
  const themeMode = useThemeMode();
  const router = useRouter();
  const locale = useLocale();
  const { driver, updateProfile, logout, requestAccountDeletion } = useAuth();
  const push = usePushHealth();
  const toast = useToast();
  const align = isRTL() ? "right" : "left";
  const Chevron = isRTL() ? ChevronLeft : ChevronRight;

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [name, setName] = useState(driver?.name ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPrefs().then((p) => { if (alive) setPrefs(p); }).catch(() => { /* keep defaults */ });
    return () => { alive = false; };
  }, []);

  // One shared in-memory copy, so the foreground push handler sees a change at once.
  const setPref = (key: PrefName) => (value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    storePref(key, value);
  };

  const [deleting, setDeleting] = useState(false);
  function confirmDeletion() {
    Alert.alert(t("settings.deleteTitle"), t("settings.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.deleteConfirm"),
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await requestAccountDeletion();
            toast.show(t("settings.deleteDone"), "success");
          } catch {
            toast.show(t("settings.deleteError"), "error");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  // Owners are read-only monitors; only real drivers can edit their profile.
  const canEdit = !driver?.is_owner;
  const dirty = name.trim() !== (driver?.name ?? "");

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const patch: { name?: string } = {};
      if (name.trim() && name.trim() !== driver?.name) patch.name = name.trim();
      await updateProfile(patch);
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
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }} accessibilityRole="button" accessibilityLabel={t("common.back")}>
          {isRTL() ? <ChevronRight size={24} color={c.ink} /> : <ChevronLeft size={24} color={c.ink} />}
        </Pressable>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700", textAlign: align }}>{t("settings.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 22 }} keyboardShouldPersistTaps="handled">
        {/* PREFERENCES */}
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("settings.preferences")}</SectionLabel>
          <View style={cardStyle(c)}>
            <NavRow icon={Globe} label={t("settings.language")} value={LANG_NAMES[locale] ?? locale} onPress={() => router.push("/language")} c={c} Chevron={Chevron} border />
            <ToggleRow icon={Bell} label={t("settings.offerNotifications")} value={prefs.notifications} onChange={setPref("notifications")} c={c} border />
            <ToggleRow icon={Volume2} label={t("settings.sound")} value={prefs.sound} onChange={setPref("sound")} c={c} border />
            <ToggleRow icon={Vibrate} label={t("settings.haptic")} value={prefs.haptic} onChange={setPref("haptic")} c={c} />
          </View>
          {/* These only govern alerts while the app is OPEN — say so, and link the
              OS settings that control lock-screen pushes. */}
          <Text style={{ color: c.inkSubtle, fontSize: 12.5, lineHeight: 18, textAlign: align }}>{t("settings.inAppHint")}</Text>
          <View style={cardStyle(c)}>
            <NavRow
              icon={push.ok ? Bell : BellOff}
              label={t("settings.systemNotifications")}
              value={push.health ? (push.ok ? t("settings.on") : t("settings.off")) : undefined}
              valueColor={push.ok ? undefined : c.danger}
              onPress={() => void push.fix()}
              c={c}
              Chevron={Chevron}
              border={Platform.OS === "android"}
            />
            {Platform.OS === "android" && (
              <NavRow
                icon={BatteryWarning}
                label={t("settings.reliableAlerts")}
                onPress={() => Linking.openSettings().catch(() => {})}
                c={c}
                Chevron={Chevron}
              />
            )}
          </View>
          {Platform.OS === "android" && (
            <Text style={{ color: c.inkSubtle, fontSize: 12.5, lineHeight: 18, textAlign: align }}>{t("settings.reliableAlertsHint")}</Text>
          )}
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
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
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

        {/* ACCOUNT — real, editable profile (name) via updateProfile. */}
        {canEdit && (
          <View style={{ gap: 10 }}>
            <SectionLabel>{t("settings.account")}</SectionLabel>
            <View style={{ gap: 10 }}>
              <Field label={t("settings.name")} value={name} onChangeText={setName} autoCapitalize="words" />
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
              onPress={() => openUrl(`mailto:${SUPPORT_EMAIL}`)}
              c={c}
              Chevron={Chevron}
              border
            />
            <NavRow icon={ShieldCheck} label={t("settings.privacy")} onPress={() => openUrl(PRIVACY_URL)} c={c} Chevron={Chevron} border />
            <NavRow icon={FileText} label={t("settings.imprint")} onPress={() => openUrl(IMPRINT_URL)} c={c} Chevron={Chevron} />
          </View>
        </View>

        {/* Account deletion (App Store 5.1.1(v), Play policy, DSGVO Art. 17). */}
        <Pressable
          onPress={confirmDeletion}
          disabled={deleting}
          accessibilityRole="button"
          style={{ ...cardStyle(c), flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, opacity: deleting ? 0.5 : 1 }}
        >
          <Trash2 size={18} color={c.danger} strokeWidth={1.8} />
          <Text style={{ color: c.danger, fontSize: 15, fontWeight: "600" }}>{t("settings.deleteAccount")}</Text>
        </Pressable>

        {/* Log out */}
        <Pressable
          onPress={() => logout()}
          accessibilityRole="button"
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

function NavRow({ icon, label, value, valueColor, onPress, c, Chevron, border }: { icon: LucideIcon; label: string; value?: string; valueColor?: string; onPress: () => void; c: Palette; Chevron: LucideIcon; border?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <RowLead icon={icon} label={label} c={c} />
      {value ? <Text style={{ color: valueColor ?? c.inkSubtle, fontSize: 14, fontWeight: "500" }}>{value}</Text> : null}
      <Chevron size={18} color={c.inkFaint} strokeWidth={1.6} />
    </Pressable>
  );
}

function ToggleRow({ icon, label, value, onChange, c, border }: { icon: LucideIcon; label: string; value: boolean; onChange: (v: boolean) => void; c: Palette; border?: boolean }) {
  return (
    <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: border ? 1 : 0, borderColor: c.line }}>
      <RowLead icon={icon} label={label} c={c} />
      <Toggle value={value} onChange={onChange} label={label} c={c} />
    </View>
  );
}

function Toggle({ value, onChange, label, c }: { value: boolean; onChange: (v: boolean) => void; label: string; c: Palette }) {
  const start = isRTL() ? "flex-end" : "flex-start";
  const end = isRTL() ? "flex-start" : "flex-end";
  return (
    <Pressable
      onPress={() => onChange(!value)}
      hitSlop={6}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={{ width: 42, height: 25, borderRadius: radius.pill, backgroundColor: value ? c.primary : c.surface2, justifyContent: "center", alignItems: value ? end : start, paddingHorizontal: 3 }}>
      <View style={{ width: 19, height: 19, borderRadius: radius.pill, backgroundColor: value ? c.primaryInk : c.inkFaint }} />
    </Pressable>
  );
}
