import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WifiOff } from "lucide-react-native";
import { Text } from "@/components/typography";
import { PrimaryButton } from "@/components/ui";
import { useColors } from "@/lib/theme";
import { t, isRTL } from "@/lib/i18n";

/**
 * Shown when a stored session exists but the server is unreachable (no internet)
 * — instead of logging the user out to the login screen. A retry re-attempts the
 * session restore. Copy follows the user's chosen app language.
 */
export function OfflineScreen({ onRetry }: { onRetry: () => Promise<void> }) {
  const c = useColors();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 18 }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 42,
            backgroundColor: c.surfaceRaised,
            borderWidth: 1,
            borderColor: c.line,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <WifiOff size={38} color={c.inkMuted} />
        </View>

        <View style={{ alignItems: "center", gap: 8 }}>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700", textAlign: "center" }}>
            {t("offline.title")}
          </Text>
          <Text style={{ color: c.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center", writingDirection: isRTL() ? "rtl" : "ltr" }}>
            {t("offline.body")}
          </Text>
        </View>

        <View style={{ alignSelf: "stretch", marginTop: 6 }}>
          <PrimaryButton label={t("offline.retry")} onPress={retry} loading={retrying} icon={WifiOff} />
        </View>
      </View>
    </SafeAreaView>
  );
}
