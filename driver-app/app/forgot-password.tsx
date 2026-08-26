import { useState } from "react";
import { View, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Send, KeyRound } from "lucide-react-native";
import { Text } from "@/components/typography";
import { Field, PrimaryButton, Logo } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors } from "@/lib/theme";

/**
 * Driver forgot-password: enter email → receive a 6-digit OTP → set a new
 * password with the code. Two steps in one screen; the second unlocks after the
 * code is requested.
 */
export default function ForgotPasswordScreen() {
  const c = useColors();
  const router = useRouter();
  const toast = useToast();
  const align = isRTL() ? "right" : "left";
  const Back = isRTL() ? ChevronRight : ChevronLeft;

  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setLoading(true);
    setError(null);
    try {
      await api.passwordForgot(email.trim());
      toast.show(t("forgot.sent"), "success");
      setStep(2);
    } catch {
      setError(t("forgot.error"));
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    if (password.length < 8) {
      setError(t("forgot.tooShort"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.passwordReset(email.trim(), otp.trim(), password);
      toast.show(t("forgot.done"), "success");
      router.replace("/login");
    } catch {
      setError(t("forgot.codeError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => (step === 2 ? setStep(1) : router.back())} hitSlop={10} style={{ padding: 6 }}>
          <Back size={24} color={c.ink} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: 16 }}
      >
        <View style={{ alignItems: "center", gap: 12, marginBottom: 28 }}>
          <Logo size={60} />
          <Text style={{ color: c.ink, fontSize: 24, fontWeight: "700", letterSpacing: -0.5, textAlign: "center" }}>
            {t("forgot.title")}
          </Text>
          <Text style={{ color: c.inkMuted, fontSize: 15, lineHeight: 21, textAlign: "center", paddingHorizontal: 8 }}>
            {step === 1 ? t("forgot.introEmail") : t("forgot.introCode")}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          {step === 1 ? (
            <>
              <Field label={t("login.email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              <View style={{ marginTop: 8 }}>
                <PrimaryButton label={t("forgot.send")} onPress={sendCode} loading={loading} icon={Send} />
              </View>
            </>
          ) : (
            <>
              <Field label={t("forgot.code")} value={otp} onChangeText={setOtp} keyboardType="number-pad" />
              <Field label={t("forgot.newPassword")} value={password} onChangeText={setPassword} secure />
              <View style={{ marginTop: 8 }}>
                <PrimaryButton label={t("forgot.reset")} onPress={reset} loading={loading} icon={KeyRound} />
              </View>
              <Pressable onPress={sendCode} disabled={loading} style={{ alignSelf: "center", paddingVertical: 10 }}>
                <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "500" }}>{t("forgot.resend")}</Text>
              </Pressable>
            </>
          )}
          {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: align }}>{error}</Text>}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
