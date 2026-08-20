import { useState } from "react";
import { View, KeyboardAvoidingView, Platform, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Field, PrimaryButton, Logo } from "@/components/ui";
import { LogIn } from "lucide-react-native";

export default function LoginScreen() {
  const { login } = useAuth();
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
            {t("login.submit")}
          </Text>
          <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 8, lineHeight: 21, textAlign: align }}>
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
            onPress={() => Alert.alert(t("signin.forgot"), t("signin.forgotHint"))}
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
