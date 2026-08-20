import { useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Text } from "@/components/typography";
import { Logo, PrimaryButton } from "@/components/ui";
import { useColors, radius } from "@/lib/theme";
import { t, isRTL, setLocale } from "@/lib/i18n";

type LangCode = "de" | "en" | "ar";

const OPTIONS: { code: LangCode; native: string; latin: string }[] = [
  { code: "de", native: "Deutsch", latin: "German" },
  { code: "en", native: "English", latin: "English" },
  { code: "ar", native: "العربية", latin: "Arabic" },
];

/**
 * Onboarding language picker: brand header, H1, three selectable option rows
 * (native + latin name with a trailing radio) and a sticky Continue button.
 * Applies the locale through the existing i18n setter, then enters the app.
 */
export default function LanguageScreen() {
  const c = useColors();
  const router = useRouter();
  const rtl = isRTL();
  const align = rtl ? "right" : "left";
  const [selected, setSelected] = useState<LangCode>("de");

  const onContinue = () => {
    setLocale(selected);
    // Persist the choice: its presence also marks onboarding as done, so the
    // splash skips this screen on later launches and re-applies the language.
    SecureStore.setItemAsync("locale", selected).catch(() => {});
    router.replace("/login");
  };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 24 }}>
        <View style={{ flexDirection: rtl ? "row-reverse" : "row", alignItems: "center", gap: 12, marginTop: 8 }}>
          <Logo size={32} />
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700", fontStyle: "italic", letterSpacing: -0.5 }}>
            REIDEY
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", textAlign: align }}>
            {t("language.choose")}
          </Text>
          <Text style={{ color: c.inkSubtle, fontSize: 14, textAlign: align }}>
            {t("language.subtitle")}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          {OPTIONS.map((opt) => {
            const on = selected === opt.code;
            return (
              <Pressable
                key={opt.code}
                onPress={() => setSelected(opt.code)}
                style={{
                  flexDirection: rtl ? "row-reverse" : "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 16,
                  borderRadius: radius.md,
                  backgroundColor: on ? c.surfaceRaised : c.surface,
                  borderWidth: 1,
                  borderColor: on ? c.borderStrong : c.line,
                }}
              >
                <View style={{ gap: 3 }}>
                  <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600", textAlign: align }}>
                    {opt.native}
                  </Text>
                  <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: align }}>
                    {opt.latin}
                  </Text>
                </View>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: radius.pill,
                    borderWidth: 2,
                    borderColor: on ? c.accent : c.borderStrong,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {on && (
                    <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: c.accent }} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderColor: c.line, backgroundColor: c.canvas }}>
        <PrimaryButton label={t("language.continue")} onPress={onContinue} />
      </View>
    </SafeAreaView>
  );
}
