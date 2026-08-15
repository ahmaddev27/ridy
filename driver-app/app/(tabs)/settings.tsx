import { useState } from "react";
import { View, Text, Pressable, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { t, setLocale, getLocale, isRTL } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { Field, PrimaryButton } from "@/components/ui";

const LANGS: { code: string; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
];

export default function SettingsScreen() {
  const { driver, updateProfile, logout } = useAuth();
  const c = useColors();
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
      Alert.alert(t("settings.saved"));
    } catch {
      Alert.alert(t("settings.saveError"));
    } finally {
      setSaving(false);
    }
  }

  function pickLang(code: string) {
    setLocale(code);
    setLocaleState(code);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.canvas }} contentContainerStyle={{ padding: 16, gap: 20 }}>
      {/* Identity card */}
      <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: c.line, gap: 4 }}>
        <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700", textAlign: align }}>{driver?.name}</Text>
        {driver?.company_name && <Text style={{ color: c.inkMuted, textAlign: align }}>{driver.company_name}</Text>}
        {driver?.email && <Text style={{ color: c.inkSubtle, textAlign: align }}>{driver.email}</Text>}
      </View>

      {/* Profile edit */}
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "700", textAlign: align }}>{t("settings.profile")}</Text>
      <View style={{ gap: 14 }}>
        <Field label={t("settings.name")} value={name} onChangeText={setName} />
        <Field label={t("settings.newPassword")} value={password} onChangeText={setPassword} secureTextEntry />
      </View>

      {/* Language */}
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
          flexDirection: "row",
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
