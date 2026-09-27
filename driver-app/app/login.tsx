import { useRef, useState } from "react";
import { View, KeyboardAvoidingView, Platform, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { PRIVACY_URL, IMPRINT_URL } from "@/lib/links";
import { t, isRTL } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { useCooldown } from "@/lib/use-cooldown";
import { Field, OtpInput, PrimaryButton, Logo } from "@/components/ui";
import { LogIn, Mail } from "@/components/icons";

type Step = "email" | "code";

/** Tell the failure modes apart instead of "invalid code" for everything. */
function loginErrorKey(e: unknown, step: "send" | "verify"): string {
  if (!(e instanceof ApiError) || e.isNetwork) return "offline.body";
  if (e.status === 429) return "otp.tooFast";
  if (e.status === 403) return "otp.suspended";
  if (step === "verify" && e.status === 422) {
    const body = (e.body ?? {}) as { errors?: { otp?: unknown[] } };
    const code = body.errors?.otp?.[0];
    if (code === "otp_too_many") return "otp.tooMany";
    if (code === "otp_expired" || code === "otp_none") return "otp.expired";
    return "otp.codeError";
  }
  return step === "send" ? "otp.sendError" : "otp.codeError";
}

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
  // One code per minute: every successful send starts a 60s cooldown that gates
  // the resend button until it elapses.
  const resendCooldown = useCooldown(60);

  async function sendCode() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await requestCode(email.trim());
      setStep("code");
      resendCooldown.start();
    } catch (e) {
      setError(t(loginErrorKey(e, "send")));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (resendCooldown.active) return; // still cooling down — ignore
    setError(null);
    try {
      await requestCode(email.trim());
      setNotice(t("otp.resent"));
      resendCooldown.start();
    } catch (e) {
      setError(t(loginErrorKey(e, "send")));
    }
  }

  // A ref, not state: onComplete (auto-submit) and the button can fire in the
  // same tick, and each extra request burns the verify throttle.
  const verifying = useRef(false);

  async function submitCode(codeValue?: string) {
    const value = (typeof codeValue === "string" ? codeValue : code).trim();
    if (verifying.current) return;
    if (value.length !== 6) {
      setError(t("otp.codeError"));
      return;
    }
    verifying.current = true;
    setLoading(true);
    setError(null);
    try {
      await verifyCode(email.trim(), value);
    } catch (e) {
      const key = loginErrorKey(e, "verify");
      if (key === "otp.tooMany") setCode(""); // the code is burnt — ask for a new one
      setError(t(key));
    } finally {
      verifying.current = false;
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
            <OtpInput value={code} onChangeText={setCode} length={6} autoFocus onComplete={submitCode} />
            {error && <Text style={{ color: c.danger, fontSize: 14, textAlign: align }}>{error}</Text>}
            {notice && <Text style={{ color: c.inkMuted, fontSize: 14, textAlign: align }}>{notice}</Text>}
            <View style={{ marginTop: 8 }}>
              <PrimaryButton label={t("otp.verify")} onPress={() => void submitCode()} loading={loading} icon={LogIn} />
            </View>
            <Pressable
              onPress={resend}
              disabled={resendCooldown.active}
              style={{ alignSelf: "center", paddingVertical: 12, opacity: resendCooldown.active ? 0.5 : 1 }}
            >
              <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "500" }}>
                {resendCooldown.active ? t("otp.resendIn", { s: String(resendCooldown.remaining) }) : t("otp.resend")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { setStep("email"); setCode(""); setError(null); setNotice(null); }}
              style={{ alignSelf: "center", paddingVertical: 4 }}
            >
              <Text style={{ color: c.inkSubtle, fontSize: 13, fontWeight: "500" }}>{t("otp.changeEmail")}</Text>
            </Pressable>
          </View>
        )}

        <View style={{ position: "absolute", bottom: 20, left: 16, right: 16, gap: 8, alignItems: "center" }}>
          <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: "center", lineHeight: 19 }}>{t("signin.inviteNote")}</Text>
          {/* Reachable before sign-in (App Review / Play policy, DDG §5). */}
          <View style={{ flexDirection: "row", gap: 16 }}>
            <Text accessibilityRole="link" onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})} style={{ color: c.inkMuted, fontSize: 12.5, fontWeight: "600" }}>
              {t("settings.privacy")}
            </Text>
            <Text accessibilityRole="link" onPress={() => Linking.openURL(IMPRINT_URL).catch(() => {})} style={{ color: c.inkMuted, fontSize: 12.5, fontWeight: "600" }}>
              {t("settings.imprint")}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
