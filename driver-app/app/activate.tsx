import { useEffect, useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { colors } from "@/lib/theme";
import { Field, PrimaryButton } from "@/components/ui";

/** Reached via the emailed deep link: reidey://activate?token=… */
export default function ActivateScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { activate } = useAuth();
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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center", padding: 24 }}
    >
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "800", marginBottom: 4 }}>
        {t("activate.title")}
      </Text>
      {checking ? (
        <ActivityIndicator color={colors.ink} style={{ marginTop: 24 }} />
      ) : (
        <>
          {preview && (
            <Text style={{ color: colors.inkMuted, fontSize: 15, marginBottom: 20 }}>
              {preview.driver_name}
              {preview.company_name ? ` · ${preview.company_name}` : ""}
            </Text>
          )}
          <Text style={{ color: colors.inkMuted, fontSize: 14, marginBottom: 20 }}>{t("activate.intro")}</Text>
          <View style={{ gap: 16 }}>
            <Field label={t("login.password")} value={password} onChangeText={setPassword} secureTextEntry />
            {error && <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>}
            <PrimaryButton
              label={t("activate.submit")}
              onPress={submit}
              loading={loading}
              disabled={!preview || password.length < 8}
            />
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
