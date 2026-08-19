import { useEffect, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Bell,
  Volume2,
  Vibrate,
  User,
  ShieldCheck,
  LifeBuoy,
  MessageCircle,
  type LucideIcon,
} from "lucide-react-native";
import { Text } from "@/components/typography";
import { SectionLabel } from "@/components/ui";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

/** Human names for each supported locale, shown on the language row. */
const LANG_NAMES: Record<string, string> = {
  de: "Deutsch",
  en: "English",
  ar: "العربية",
};

/** SecureStore keys for the three persisted preference toggles. */
const PREF_KEYS = {
  notifications: "pref.notifications",
  sound: "pref.sound",
  haptic: "pref.haptic",
} as const;

type PrefState = { notifications: boolean; sound: boolean; haptic: boolean };

const DEFAULT_PREFS: PrefState = { notifications: true, sound: true, haptic: true };

export default function SettingsScreen() {
  const c = useColors();
  const router = useRouter();
  const locale = useLocale();
  const align = isRTL() ? "right" : "left";
  const Chevron = isRTL() ? ChevronLeft : ChevronRight;

  const [prefs, setPrefs] = useState<PrefState>(DEFAULT_PREFS);

  // Load persisted toggles on mount.
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
          notifications: n === null ? DEFAULT_PREFS.notifications : n === "1",
          sound: s === null ? DEFAULT_PREFS.sound : s === "1",
          haptic: h === null ? DEFAULT_PREFS.haptic : h === "1",
        });
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setPref = (key: keyof PrefState, storeKey: string) => (value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    SecureStore.setItemAsync(storeKey, value ? "1" : "0").catch(() => {
      /* best-effort persistence */
    });
  };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      {/* Header */}
      <View
        style={{
          flexDirection: isRTL() ? "row-reverse" : "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{ padding: 6, borderRadius: radius.pill }}
        >
          {isRTL() ? <ChevronRight size={24} color={c.ink} /> : <ChevronLeft size={24} color={c.ink} />}
        </Pressable>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800", textAlign: align }}>
          {t("settings.title")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 22 }}>
        {/* PREFERENCES */}
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("settings.preferences")}</SectionLabel>
          <View style={cardStyle(c)}>
            <NavRow
              icon={Globe}
              label={t("settings.language")}
              value={LANG_NAMES[locale] ?? locale}
              onPress={() => router.push("/language")}
              c={c}
              Chevron={Chevron}
              border
            />
            <ToggleRow
              icon={Bell}
              label={t("settings.offerNotifications")}
              value={prefs.notifications}
              onChange={setPref("notifications", PREF_KEYS.notifications)}
              c={c}
              border
            />
            <ToggleRow
              icon={Volume2}
              label={t("settings.sound")}
              value={prefs.sound}
              onChange={setPref("sound", PREF_KEYS.sound)}
              c={c}
              border
            />
            <ToggleRow
              icon={Vibrate}
              label={t("settings.haptic")}
              value={prefs.haptic}
              onChange={setPref("haptic", PREF_KEYS.haptic)}
              c={c}
            />
          </View>
        </View>

        {/* ACCOUNT */}
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("settings.account")}</SectionLabel>
          <View style={cardStyle(c)}>
            <NavRow
              icon={User}
              label={t("settings.personalInfo")}
              onPress={() => {}}
              c={c}
              Chevron={Chevron}
              border
            />
            <NavRow
              icon={ShieldCheck}
              label={t("settings.security")}
              onPress={() => {}}
              c={c}
              Chevron={Chevron}
            />
          </View>
        </View>

        {/* SUPPORT */}
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("settings.support")}</SectionLabel>
          <View style={cardStyle(c)}>
            <NavRow
              icon={LifeBuoy}
              label={t("settings.helpCenter")}
              onPress={() => {}}
              c={c}
              Chevron={Chevron}
              border
            />
            <NavRow
              icon={MessageCircle}
              label={t("settings.contactSupport")}
              onPress={() => {}}
              c={c}
              Chevron={Chevron}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Leading icon + label used by every settings row. */
function RowLead({ icon: Icon, label, c }: { icon: LucideIcon; label: string; c: Palette }) {
  return (
    <View
      style={{
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 12,
        flex: 1,
      }}
    >
      <Icon size={19} color={c.inkMuted} strokeWidth={1.6} />
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "500", textAlign: isRTL() ? "right" : "left" }}>
        {label}
      </Text>
    </View>
  );
}

/** Tappable row that navigates elsewhere (optional trailing value + chevron). */
function NavRow({
  icon,
  label,
  value,
  onPress,
  c,
  Chevron,
  border,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  onPress: () => void;
  c: Palette;
  Chevron: LucideIcon;
  border?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 15,
        borderBottomWidth: border ? 1 : 0,
        borderColor: c.line,
      }}
    >
      <RowLead icon={icon} label={label} c={c} />
      {value ? (
        <Text style={{ color: c.inkSubtle, fontSize: 14, fontWeight: "500" }}>{value}</Text>
      ) : null}
      <Chevron size={18} color={c.inkFaint} strokeWidth={1.6} />
    </Pressable>
  );
}

/** Row with the reusable Toggle on the trailing side. */
function ToggleRow({
  icon,
  label,
  value,
  onChange,
  c,
  border,
}: {
  icon: LucideIcon;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  c: Palette;
  border?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: border ? 1 : 0,
        borderColor: c.line,
      }}
    >
      <RowLead icon={icon} label={label} c={c} />
      <Toggle value={value} onChange={onChange} c={c} />
    </View>
  );
}

/**
 * Reusable pill toggle. On = primary track with a primaryInk knob; off =
 * surface2 track with an inkFaint knob. The knob slides with the writing
 * direction so it reads correctly in both LTR and RTL.
 */
function Toggle({ value, onChange, c }: { value: boolean; onChange: (v: boolean) => void; c: Palette }) {
  const start = isRTL() ? "flex-end" : "flex-start";
  const end = isRTL() ? "flex-start" : "flex-end";
  return (
    <Pressable
      onPress={() => onChange(!value)}
      hitSlop={6}
      style={{
        width: 42,
        height: 25,
        borderRadius: radius.pill,
        backgroundColor: value ? c.primary : c.surface2,
        justifyContent: "center",
        alignItems: value ? end : start,
        paddingHorizontal: 3,
      }}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: radius.pill,
          backgroundColor: value ? c.primaryInk : c.inkFaint,
        }}
      />
    </Pressable>
  );
}
