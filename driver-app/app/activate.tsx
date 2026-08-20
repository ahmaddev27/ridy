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
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: 16 }}
      >
        {/* Brand */}
        <View
          style={{
            flexDirection: isRTL() ? "row-reverse" : "row",
            alignItems: "center",
            gap: 9,
            marginBottom: 40,
          }}
        >
          <Logo size={30} />
          <Text style={{ color: c.ink, fontSize: 21, fontWeight: "700", fontStyle: "italic", letterSpacing: 1.2 }}>
            REIDEY
          </Text>
        </View>

        {/* Heading */}
        <View style={{ marginBottom: 28 }}>
          <Text style={{ color: c.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.8, textAlign: align }}>
            {t("activate.title")}
          </Text>
          {preview ? (
            <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 8, lineHeight: 21, textAlign: align }}>
              {preview.driver_name}
              {preview.company_name ? ` · ${preview.company_name}` : ""}
            </Text>
          ) : (
            <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 8, lineHeight: 21, textAlign: align }}>
              {t("activate.intro")}
            </Text>
          )}
        </View>

        {checking ? (
          <ActivityIndicator color={c.ink} />
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={{ color: c.inkMuted, fontSize: 14, lineHeight: 20, textAlign: align }}>{t("activate.intro")}</Text>
            <Field label={t("login.password")} value={password} onChangeText={setPassword} secure />
            {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: align }}>{error}</Text>}
            <View style={{ marginTop: 8 }}>
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
