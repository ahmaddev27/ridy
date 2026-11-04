"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { OtpInput } from "@/components/ui/otp-input";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthField } from "@/components/auth/auth-field";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { forgotPassword, verifyResetCode, resetPassword } from "@/lib/api/password-reset";

type Step = "email" | "code" | "password";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const r = (k: string) => t(`forgot.${k}`);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  // Resend cooldown: disabled with a live countdown after each send.
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startCooldown = () => {
    setCooldown(60);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && timer.current) clearInterval(timer.current);
        return Math.max(0, s - 1);
      });
    }, 1000);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
      toast.success(r("codeSent"), { description: email });
      setStep("code");
      startCooldown();
    } catch (err) {
      toast.error(r("failed"), { description: apiErrorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  // Step 2 — verify the code alone before asking for a new password.
  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyResetCode(email, otp.trim());
      setStep("password");
    } catch (err) {
      toast.error(r("resetFailed"), { description: apiErrorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error(r("resetFailed"), { description: r("mismatch") });
      return;
    }
    setBusy(true);
    try {
      await resetPassword(email, otp.trim(), password, confirm);
      toast.success(r("resetDone"));
      router.push("/login");
    } catch (err) {
      toast.error(r("resetFailed"), { description: apiErrorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await forgotPassword(email);
      toast.success(r("codeResent"));
      startCooldown();
    } catch (err) {
      toast.error(r("failed"), { description: apiErrorMessage(err, t) });
    }
  }

  const stepNo = step === "email" ? 1 : step === "code" ? 2 : 3;
  const heading =
    step === "email"
      ? { title: r("title"), subtitle: r("subtitle") }
      : step === "code"
        ? { title: r("resetTitle"), subtitle: r("resetSubtitle").replace("{email}", email) }
        : { title: r("newTitle"), subtitle: r("newSubtitle") };

  const backToLogin = (
    <Link href="/login" className="btn btn-ghost btn-block">
      {r("backToLogin")}
    </Link>
  );

  return (
    <AuthLayout
      {...heading}
      steps={stepNo}
      panelTitle={r("panelTitle")}
      panelSubtitle={r("panelSubtitle")}
    >
      {step === "email" && (
        <form onSubmit={submitEmail}>
          <AuthField label={r("email")} type="email" value={email} onChange={setEmail} required />
          <button type="submit" disabled={busy} className="btn btn-primary btn-lg btn-block">
            {busy && <Loader2 className="animate-spin" />}
            {r("sendCode")}
          </button>
          {backToLogin}
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode}>
          <OtpInput value={otp} onChange={setOtp} autoFocus />
          <button type="submit" disabled={busy || otp.length < 6} className="btn btn-primary btn-lg btn-block">
            {busy && <Loader2 className="animate-spin" />}
            {r("verifyCta")}
          </button>
          <button type="button" onClick={resend} disabled={cooldown > 0} className="btn btn-ghost btn-block">
            {cooldown > 0 ? r("resendIn").replace("{s}", String(cooldown)) : r("resend")}
          </button>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={submitPassword}>
          <AuthField
            label={r("newPassword")}
            type="password"
            value={password}
            onChange={setPassword}
            required
            minLength={8}
            autoFocus
          />
          <AuthField
            label={r("confirmPassword")}
            type="password"
            value={confirm}
            onChange={setConfirm}
            required
            minLength={8}
          />
          <button type="submit" disabled={busy || password.length < 8} className="btn btn-primary btn-lg btn-block">
            {busy && <Loader2 className="animate-spin" />}
            {r("resetCta")}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
