import { useState } from "react";
import { View, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Field, PrimaryButton, Logo } from "@/components/ui";
import { LogIn, Mail } from "lucide-react-native";

type Step = "email" | "code";

export default function LoginScreen() {
  const { requestCode, verifyCode } = useAuth();
  const c = useColors();
  const align = isRTL() ? "right" : "left";
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await requestCode(email.trim());
      setStep("code");
    } catch {
      setError(t("otp.sendError"));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await requestCode(email.trim());
      setNotice(t("otp.resent"));
    } catch {
      setError(t("otp.sendError"));
    }
  }

  async function submitCode() {
    setLoading(true);
    setError(null);
    try {
      await verifyCode(email.trim(), code.trim());
    } catch {
      setError(t("otp.codeError"));
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
            {t(step === "email" ? "otp.emailTitle" : "otp.codeTitle")}
          </Text>
          <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: 8, lineHeight: 21, textAlign: "center" }}>
            {step === "email" ? t("otp.emailIntro") : t("otp.codeIntro", { email: email.trim() })}
          </Text>
        </View>

        {step === "email" ? (
          <View style={{ gap: 12 }}>
            <Field label={t("login.email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: align }}>{error}</Text>}
            <View style={{ marginTop: 8 }}>
              <PrimaryButton label={t("otp.send")} onPress={sendCode} loading={loading} icon={Mail} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Field
              label={t("otp.code")}
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
            />
            {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: align }}>{error}</Text>}
            {notice && <Text style={{ color: c.inkMuted, fontSize: 14, textAlign: align }}>{notice}</Text>}
            <View style={{ marginTop: 8 }}>
              <PrimaryButton label={t("otp.verify")} onPress={submitCode} loading={loading} icon={LogIn} />
            </View>
            <Pressable onPress={resend} style={{ alignSelf: "center", paddingVertical: 12 }}>
              <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "500" }}>{t("otp.resend")}</Text>
            </Pressable>
            <Pressable
              onPress={() => { setStep("email"); setCode(""); setError(null); setNotice(null); }}
              style={{ alignSelf: "center", paddingVertical: 4 }}
            >
              <Text style={{ color: c.inkSubtle, fontSize: 13, fontWeight: "500" }}>{t("otp.changeEmail")}</Text>
            </Pressable>
          </View>
        )}

        <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: "center", position: "absolute", bottom: 20, left: 16, right: 16, lineHeight: 19 }}>
          {t("signin.inviteNote")}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
