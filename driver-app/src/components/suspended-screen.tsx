import { View, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { Logo, PrimaryButton } from "@/components/ui";
import { useColors } from "@/lib/theme";
import { t, isRTL } from "@/lib/i18n";
import type { SuspendedInfo } from "@/lib/auth";

const KNOWN_REASONS = ["disabled", "banned", "inactive", "expired"];

/** wa.me wants digits only (country code included, no "+"). */
function whatsappUrl(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

/**
 * Shown when the driver's company is suspended (subscription lapsed, disabled or
 * banned) — instead of a misleading "no internet" or "invalid code". Explains
 * why and how to reach support; "Back" returns to the login screen.
 */
export function SuspendedScreen({ info, onBack }: { info: SuspendedInfo; onBack: () => void }) {
  const c = useColors();
  const reason = info.reason && KNOWN_REASONS.includes(info.reason) ? info.reason : "disabled";
  const wa = info.supportWhatsapp ? whatsappUrl(info.supportWhatsapp) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 18 }}>
        <Logo size={64} />
        <View style={{ alignItems: "center", gap: 8 }}>
          <Text style={{ color: c.ink, fontSize: 21, fontWeight: "700", textAlign: "center" }}>{t("suspended.title")}</Text>
          <Text
            style={{
              color: c.inkMuted,
              fontSize: 15,
              lineHeight: 22,
              textAlign: "center",
              writingDirection: isRTL() ? "rtl" : "ltr",
            }}
          >
            {t(`suspended.body.${reason}`)}
          </Text>
        </View>

        {(info.supportEmail || wa) && (
          <View style={{ alignItems: "center", gap: 10 }}>
            <Text style={{ color: c.inkSubtle, fontSize: 13 }}>{t("suspended.contact")}</Text>
            {info.supportEmail && (
              <Text
                accessibilityRole="link"
                onPress={() => Linking.openURL(`mailto:${info.supportEmail}`).catch(() => {})}
                style={{ color: c.ink, fontSize: 15, fontWeight: "600", writingDirection: "ltr" }}
              >
                {info.supportEmail}
              </Text>
            )}
            {wa && (
              <Text
                accessibilityRole="link"
                onPress={() => Linking.openURL(wa).catch(() => {})}
                style={{ color: c.ink, fontSize: 15, fontWeight: "600", writingDirection: "ltr" }}
              >
                WhatsApp {info.supportWhatsapp}
              </Text>
            )}
          </View>
        )}

        <View style={{ alignSelf: "stretch", marginTop: 6 }}>
          <PrimaryButton label={t("suspended.back")} onPress={onBack} />
        </View>
      </View>
    </SafeAreaView>
  );
}
