import { useEffect, useState } from "react";
import { View, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Text } from "@/components/typography";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Field, PrimaryButton, Logo } from "@/components/ui";
import { CheckCircle } from "lucide-react-native";

/** Reached via the emailed deep link: reidey://activate?token=… */
export default function ActivateScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { activate } = useAuth();
  const c = useColors();
  const align = isRTL() ? "right" : "left";
  const [preview, setPreview] = useState<{ driver_name: string; company_name: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) {
      setError(t("activate.invalid"));
      setChecking(false);
      return;
    }
    api
      .invitePreview(token)
      .then((r) => setPreview(r.data))
      .catch(() => setError(t("activate.invalid")))
      .finally(() => setChecking(false));
  }, [token]);

  async function submit() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await activate(token, password);
    } catch {
      setError(t("activate.invalid"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: 24 }}
      >
        {/* Brand */}
        <View style={{ alignItems: "center", marginBottom: 32 }}>
          <Logo size={72} />
          <Text style={{ color: c.ink, fontSize: 28, fontWeight: "800", marginTop: 16, textAlign: "center" }}>
            {t("activate.title")}
          </Text>
          {preview && (
            <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 6, textAlign: "center" }}>
              {preview.driver_name}
              {preview.company_name ? ` · ${preview.company_name}` : ""}
            </Text>
          )}
        </View>

        {checking ? (
          <ActivityIndicator color={c.ink} />
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={{ color: c.inkMuted, fontSize: 14, textAlign: align }}>{t("activate.intro")}</Text>
            <Field label={t("login.password")} value={password} onChangeText={setPassword} secure />
            {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: "center" }}>{error}</Text>}
            <View style={{ marginTop: 4 }}>
              <PrimaryButton
                label={t("activate.submit")}
                onPress={submit}
                loading={loading}
                disabled={!preview || password.length < 8}
                icon={CheckCircle}
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
