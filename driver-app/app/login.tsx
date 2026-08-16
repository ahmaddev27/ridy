import { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Field, PrimaryButton, Logo } from "@/components/ui";

export default function LoginScreen() {
  const { login } = useAuth();
  const c = useColors();
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
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: 24 }}
      >
        {/* Brand */}
        <View style={{ alignItems: "center", marginBottom: 32 }}>
          <Logo size={72} />
          <Text style={{ color: c.ink, fontSize: 28, fontWeight: "800", marginTop: 16 }}>Reidey Driver</Text>
          <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 6, textAlign: "center" }}>{t("signin.subtitle")}</Text>
        </View>

        <View style={{ gap: 12 }}>
          <Field label={t("login.email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label={t("login.password")} value={password} onChangeText={setPassword} secure />
          {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: "center" }}>{error}</Text>}
          <View style={{ marginTop: 4 }}>
            <PrimaryButton label={t("login.submit")} onPress={submit} loading={loading} />
          </View>
          <Pressable
            onPress={() => Alert.alert(t("signin.forgot"), t("signin.forgotHint"))}
            style={{ alignSelf: "center", paddingVertical: 10 }}
          >
            <Text style={{ color: c.inkMuted, fontSize: 15 }}>{t("signin.forgot")}</Text>
          </Pressable>
        </View>

        <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: "center", position: "absolute", bottom: 24, left: 24, right: 24, lineHeight: 19 }}>
          {t("signin.inviteNote")}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
