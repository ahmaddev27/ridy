import { View, Text, Pressable } from "react-native";
import { useAuth } from "@/lib/auth";
import { t, setLocale, getLocale } from "@/lib/i18n";
import { colors, radius } from "@/lib/theme";
import { useState } from "react";

const LANGS: { code: string; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
];

export default function SettingsScreen() {
  const { driver, logout } = useAuth();
  const [locale, setLocaleState] = useState(getLocale());

  function pick(code: string) {
    setLocale(code);
    setLocaleState(code);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16, gap: 20 }}>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line }}>
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>{driver?.name}</Text>
        {driver?.company_name && <Text style={{ color: colors.inkMuted, marginTop: 2 }}>{driver.company_name}</Text>}
        {driver?.email && <Text style={{ color: colors.inkSubtle, marginTop: 2 }}>{driver.email}</Text>}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.inkMuted, fontSize: 13 }}>{t("settings.language")}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {LANGS.map((l) => (
            <Pressable
              key={l.code}
              onPress={() => pick(l.code)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: radius.md,
                backgroundColor: locale === l.code ? colors.primary : colors.surface2,
              }}
            >
              <Text style={{ color: locale === l.code ? colors.primaryInk : colors.inkMuted, fontWeight: "600" }}>
                {l.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        onPress={logout}
        style={{ marginTop: "auto", paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: "center" }}
      >
        <Text style={{ color: colors.danger, fontWeight: "700" }}>{t("settings.logout")}</Text>
      </Pressable>
    </View>
  );
}
