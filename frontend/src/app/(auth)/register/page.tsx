"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { AuthLayout } from "@/components/auth/auth-layout";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { login } from "@/lib/api/auth";
import { startRegistration, verifyRegistration, resendOtp } from "@/lib/api/register";
import { WhatsAppButton } from "@/components/support/whatsapp-button";

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
    <AuthLayout panelTitle={r("panelTitle")} panelSubtitle={r("panelSubtitle")}>
      <div>
        {step === "form" ? (
          <form onSubmit={submitForm} className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">{r("title")}</h1>
              <p className="mt-1.5 text-sm text-ink-muted">{r("subtitle")}</p>
            </div>
            <Field label={r("company")} value={company} onChange={setCompany} />
            <Field label={r("name")} value={name} onChange={setName} />
            <Field label={r("phone")} type="tel" value={phone} onChange={setPhone} />
            <Field label={r("email")} type="email" value={email} onChange={setEmail} />
            <Field label={r("password")} type="password" value={password} onChange={setPassword} />
            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {r("createAccount")}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">{r("verifyTitle")}</h1>
              <p className="mt-1.5 text-sm text-ink-muted">{r("verifySubtitle").replace("{email}", email)}</p>
            </div>
            <div className="py-2">
              <OtpInput value={otp} onChange={setOtp} autoFocus />
            </div>
            <Button type="submit" disabled={busy || otp.length < 6} className="w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {r("verify")}
            </Button>
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0 || resending}
              className="w-full text-center text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-ink-muted"
            >
              {cooldown > 0 ? r("resendIn").replace("{s}", String(cooldown)) : r("resend")}
            </button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        {r("haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          {r("signIn")}
        </Link>
      </p>

      <div className="mt-4 flex justify-center">
        <WhatsAppButton />
      </div>
    </AuthLayout>
  );
}


function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      {type === "password" ? (
        <PasswordInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="w-full rounded-lg border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20"
        />
      )}
    </div>
  );
}
