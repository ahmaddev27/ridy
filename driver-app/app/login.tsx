import { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform } from "react-native";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Field, PrimaryButton } from "@/components/ui";

export default function LoginScreen() {
  const { login } = useAuth();
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch {
      setError(t("login.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center", padding: 24 }}
    >
      <Text style={{ color: colors.ink, fontSize: 28, fontWeight: "800", marginBottom: 4, textAlign: isRTL() ? "right" : "left" }}>Reidey</Text>
      <Text style={{ color: colors.inkMuted, fontSize: 16, marginBottom: 28, textAlign: isRTL() ? "right" : "left" }}>{t("login.title")}</Text>

      <View style={{ gap: 16 }}>
        <Field
          label={t("login.email")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          label={t("login.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {error && <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>}
        <PrimaryButton label={t("login.submit")} onPress={submit} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}
