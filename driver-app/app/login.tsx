import { useState } from "react";
import { View, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Text } from "@/components/typography";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Field, PrimaryButton, Logo } from "@/components/ui";
import { LogIn } from "lucide-react-native";

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const c = useColors();
  const align = isRTL() ? "right" : "left";
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
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: 16 }}
      >
        {/* Brand — centered, prominent monogram over the wordmark */}
        <View style={{ alignItems: "center", gap: 14, marginBottom: 36 }}>
          <Logo size={72} />
          <Text style={{ color: c.ink, fontSize: 27, fontWeight: "800", fontStyle: "italic", letterSpacing: 1.5 }}>
            REIDEY
          </Text>
        </View>

        {/* Heading — centered under the brand */}
        <View style={{ marginBottom: 28, alignItems: "center", paddingHorizontal: 8 }}>
          <Text style={{ color: c.ink, fontSize: 28, fontWeight: "700", letterSpacing: -0.6, textAlign: "center" }}>
            {t("login.submit")}
          </Text>
          <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 8, lineHeight: 21, textAlign: "center" }}>
            {t("signin.subtitle")}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <Field label={t("login.email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label={t("login.password")} value={password} onChangeText={setPassword} secure />
          {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: align }}>{error}</Text>}
          <View style={{ marginTop: 8 }}>
            <PrimaryButton label={t("login.submit")} onPress={submit} loading={loading} icon={LogIn} />
          </View>
          <Pressable
            onPress={() => router.push("/forgot-password")}
            style={{ alignSelf: "center", paddingVertical: 12 }}
          >
            <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "500" }}>{t("signin.forgot")}</Text>
          </Pressable>
        </View>

        <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: "center", position: "absolute", bottom: 20, left: 16, right: 16, lineHeight: 19 }}>
          {t("signin.inviteNote")}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
