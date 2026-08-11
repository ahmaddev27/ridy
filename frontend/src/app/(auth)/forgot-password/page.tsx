"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
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

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
      toast.success(r("codeSent"), { description: email });
      setStep("code");
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
    } catch (err) {
      toast.error(r("failed"), { description: apiErrorMessage(err, t) });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={44} className="text-slate-900" />
          <div className="leading-tight">
            <div className="text-lg font-bold text-slate-900">Reidey</div>
            <div className="text-xs text-slate-400">Fleet Management</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {step === "email" && (
            <form onSubmit={submitEmail} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">{r("title")}</h1>
              <p className="text-sm text-slate-400">{r("subtitle")}</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{r("email")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
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
              <h1 className="text-lg font-semibold text-slate-900">{r("resetTitle")}</h1>
              <p className="text-sm text-slate-400">{r("resetSubtitle").replace("{email}", email)}</p>
              <div className="py-2">
                <OtpInput value={otp} onChange={setOtp} autoFocus />
              </div>
              <Button type="submit" disabled={busy || otp.length < 6} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("verifyCta")}
              </Button>
              <button type="button" onClick={resend} className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800">
                {r("resend")}
              </button>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={submitPassword} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">{r("newTitle")}</h1>
              <p className="text-sm text-slate-400">{r("newSubtitle")}</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{r("newPassword")}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{r("confirmPassword")}</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <Button type="submit" disabled={busy || password.length < 8} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("resetCta")}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            {r("backToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}
