import { useCallback, useEffect, useState } from "react";
import { View, Linking, Platform, AppState } from "react-native";
import Constants from "expo-constants";
import { Text } from "@/components/typography";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Logo, PrimaryButton } from "@/components/ui";

type Gate = { required: boolean; storeUrl: string | null };

// The update URL arrives from the /app/version response. A malicious or MITM'd
// backend could point it anywhere (open redirect / phishing), so only ever open
// an https URL on a trusted host: a known app store, or our own domain (where the
// admin hosts the APK before the app is on the stores). Otherwise fall back to a
// hardcoded default.
const ALLOWED_STORE_HOSTS = ["play.google.com", "apps.apple.com", "market.android.com"];
const TRUSTED_DOMAIN = "reidey.de"; // our own site (admin-hosted APK / update page)
const DEFAULT_STORE_URL =
  Platform.OS === "ios"
    ? "https://apps.apple.com/"
    : "https://play.google.com/store/apps";

function isAllowedUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return (
      ALLOWED_STORE_HOSTS.includes(parsed.hostname) ||
      parsed.hostname === TRUSTED_DOMAIN ||
      parsed.hostname.endsWith("." + TRUSTED_DOMAIN)
    );
  } catch {
    return false;
  }
}

/**
 * Blocks the app when the installed build is older than the minimum the admin
 * configured. Re-checks on every foreground (not just cold launch) so a driver
 * who leaves the app open is gated as soon as the admin raises the minimum and
 * they return. Fails open: any error (offline, endpoint down) lets the app
 * through, so the gate can never lock a driver out by accident.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const [gate, setGate] = useState<Gate | null>(null);

  const check = useCallback(() => {
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const version = Constants.expoConfig?.version ?? "1.0.0";
    api
      .appVersion(platform, version)
      .then((r) => setGate({ required: r.update_required, storeUrl: r.store_url }))
      // Keep any prior "required" state on a transient error — never drop a gate
      // that was already shown just because one refresh failed.
      .catch(() => setGate((prev) => prev ?? { required: false, storeUrl: null }));
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  if (gate?.required) {
    return (
      <View style={{ flex: 1, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
        <Logo size={72} />
        <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: 8 }}>{t("update.title")}</Text>
        <Text style={{ color: c.inkMuted, fontSize: 15, textAlign: "center", lineHeight: 22 }}>{t("update.body")}</Text>
        <View style={{ alignSelf: "stretch", marginTop: 8 }}>
          <PrimaryButton
            label={t("update.button")}
            onPress={() => Linking.openURL(isAllowedUrl(gate.storeUrl) ? gate.storeUrl : DEFAULT_STORE_URL)}
          />
        </View>
      </View>
    );
  }

  return <>{children}</>;
}
