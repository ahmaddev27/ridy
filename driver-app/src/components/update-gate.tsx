import { useEffect, useState } from "react";
import { View, Text, Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Logo, PrimaryButton } from "@/components/ui";

type Gate = { required: boolean; storeUrl: string | null };

/**
 * Blocks the app on launch when the installed build is older than the minimum
 * the admin configured. Fails open: any error (offline, endpoint down) lets the
 * app through, so the gate can never lock a driver out by accident.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const [gate, setGate] = useState<Gate | null>(null);

  useEffect(() => {
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const version = Constants.expoConfig?.version ?? "1.0.0";
    api
      .appVersion(platform, version)
      .then((r) => setGate({ required: r.update_required, storeUrl: r.store_url }))
      .catch(() => setGate({ required: false, storeUrl: null }));
  }, []);

  if (gate?.required) {
    return (
      <View style={{ flex: 1, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
        <Logo size={72} />
        <Text style={{ color: c.ink, fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: 8 }}>{t("update.title")}</Text>
        <Text style={{ color: c.inkMuted, fontSize: 15, textAlign: "center", lineHeight: 22 }}>{t("update.body")}</Text>
        {gate.storeUrl && (
          <View style={{ alignSelf: "stretch", marginTop: 8 }}>
            <PrimaryButton label={t("update.button")} onPress={() => Linking.openURL(gate.storeUrl!)} />
          </View>
        )}
      </View>
    );
  }

  return <>{children}</>;
}
