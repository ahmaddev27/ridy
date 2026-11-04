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
import { login } from "@/lib/api/auth";
import { startRegistration, verifyRegistration, resendOtp } from "@/lib/api/register";

const RESEND_COOLDOWN_SECONDS = 60;

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useI18n();
  const r = (k: string) => t(`register.${k}`);

  const [step, setStep] = useState<"form" | "otp">("form");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live countdown for the resend button: ticks down to 0, then re-enables.
  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = setInterval(() => {
      setCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [cooldown]);

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await startRegistration({ company_name: company, name, phone, email, password });
      toast.success(r("codeSent"), { description: email });
      setStep("otp");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      toast.error(r("failed"), { description: apiErrorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyRegistration(email, otp.trim());
    } catch (err) {
      toast.error(r("verifyFailed"), { description: apiErrorMessage(err, t) });
      setBusy(false);
      return;
    }

    // Verified. A brand-new company isn't activated yet, so signing in is blocked
    // (account_suspended). Instead of a dead-end, send them to the sign-in screen,
    // which offers the activation-code entry ("have a code?").
    try {
      const user = await login(email, password);
      router.push(user.roles.includes("super_admin") ? "/admin" : "/dashboard");
    } catch {
      toast.success(r("verifiedNeedsCode"));
      router.push("/login");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await resendOtp(email);
      toast.success(r("codeResent"));
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      toast.error(r("failed"), { description: apiErrorMessage(err, t) });
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout
      title={step === "form" ? r("title") : r("verifyTitle")}
      subtitle={step === "form" ? r("subtitle") : r("verifySubtitle").replace("{email}", email)}
      panelTitle={r("panelTitle")}
      panelSubtitle={r("panelSubtitle")}
    >
      {step === "form" ? (
        <form onSubmit={submitForm}>
          <AuthField label={r("company")} value={company} onChange={setCompany} required />
          <AuthField label={r("name")} value={name} onChange={setName} required />
          <AuthField label={r("phone")} type="tel" value={phone} onChange={setPhone} required />
          <AuthField label={r("email")} type="email" value={email} onChange={setEmail} required />
          <AuthField label={r("password")} type="password" value={password} onChange={setPassword} required />
          <button type="submit" disabled={busy} className="btn btn-primary btn-lg btn-block">
            {busy && <Loader2 className="animate-spin" />}
            {r("createAccount")}
          </button>
          <p className="foot-line">
            {r("haveAccount")}{" "}
            <Link href="/login" className="link">
              {r("signIn")}
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={submitOtp}>
          <OtpInput value={otp} onChange={setOtp} autoFocus />
          <button type="submit" disabled={busy || otp.length < 6} className="btn btn-primary btn-lg btn-block">
            {busy && <Loader2 className="animate-spin" />}
            {r("verify")}
          </button>
          <button type="button" onClick={resend} disabled={cooldown > 0 || resending} className="btn btn-ghost btn-block">
            {cooldown > 0 ? r("resendIn").replace("{s}", String(cooldown)) : r("resend")}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
