"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { WhatsAppButton } from "@/components/support/whatsapp-button";
import { Logo } from "@/components/brand/logo";
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
          {step === "email" && (
            <form onSubmit={submitEmail} className="space-y-3">
              <h1 className="text-lg font-semibold text-ink">{r("title")}</h1>
              <p className="text-sm text-ink-subtle">{r("subtitle")}</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">{r("email")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("sendCode")}
              </Button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={submitCode} className="space-y-3">
              <h1 className="text-lg font-semibold text-ink">{r("resetTitle")}</h1>
              <p className="text-sm text-ink-subtle">{r("resetSubtitle").replace("{email}", email)}</p>
              <div className="py-2">
                <OtpInput value={otp} onChange={setOtp} autoFocus />
              </div>
              <Button type="submit" disabled={busy || otp.length < 6} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("verifyCta")}
              </Button>
              <button
                type="button"
                onClick={resend}
                disabled={cooldown > 0}
                className="w-full text-center text-xs font-medium text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cooldown > 0 ? r("resendIn").replace("{s}", String(cooldown)) : r("resend")}
              </button>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={submitPassword} className="space-y-3">
              <h1 className="text-lg font-semibold text-ink">{r("newTitle")}</h1>
              <p className="text-sm text-ink-subtle">{r("newSubtitle")}</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">{r("newPassword")}</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">{r("confirmPassword")}</label>
                <PasswordInput
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <Button type="submit" disabled={busy || password.length < 8} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("resetCta")}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-ink-muted">
          <Link href="/login" className="font-medium text-ink hover:underline">
            {r("backToLogin")}
          </Link>
        </p>

        <div className="mt-4 flex justify-center">
          <WhatsAppButton />
        </div>
      </div>
    </div>
  );
}
