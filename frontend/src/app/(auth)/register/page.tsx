"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { Logo } from "@/components/brand/logo";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { login } from "@/lib/api/auth";
import { startRegistration, verifyRegistration, resendOtp } from "@/lib/api/register";

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

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await startRegistration({ company_name: company, name, phone, email, password });
      toast.success(r("codeSent"), { description: email });
      setStep("otp");
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
    try {
      await resendOtp(email);
      toast.success(r("codeResent"));
    } catch (err) {
      toast.error(r("failed"), { description: apiErrorMessage(err, t) });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={72} className="text-ink" />
          <div className="leading-tight">
            <div className="text-lg font-bold text-ink">Reidey</div>
            <div className="text-xs text-ink-subtle">Fleet Management</div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          {step === "form" ? (
            <form onSubmit={submitForm} className="space-y-3">
              <h1 className="text-lg font-semibold text-ink">{r("title")}</h1>
              <p className="text-sm text-ink-subtle">{r("subtitle")}</p>
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
            <form onSubmit={submitOtp} className="space-y-3">
              <h1 className="text-lg font-semibold text-ink">{r("verifyTitle")}</h1>
              <p className="text-sm text-ink-subtle">{r("verifySubtitle").replace("{email}", email)}</p>
              <div className="py-2">
                <OtpInput value={otp} onChange={setOtp} autoFocus />
              </div>
              <Button type="submit" disabled={busy || otp.length < 6} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("verify")}
              </Button>
              <button type="button" onClick={resend} className="w-full text-center text-xs font-medium text-ink-muted hover:text-ink">
                {r("resend")}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-ink-muted">
          {r("haveAccount")}{" "}
          <Link href="/login" className="font-medium text-ink hover:underline">
            {r("signIn")}
          </Link>
        </p>
      </div>
    </div>
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
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
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
          className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line"
        />
      )}
    </div>
  );
}
