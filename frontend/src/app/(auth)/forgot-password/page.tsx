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
import { ApiError } from "@/lib/api/client";
import { forgotPassword, resetPassword } from "@/lib/api/password-reset";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const r = (k: string) => t(`forgot.${k}`);

  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
      toast.success(r("codeSent"), { description: email });
      setStep("reset");
    } catch (err) {
      toast.error(r("failed"), { description: fieldError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await resetPassword(email, otp.trim(), password);
      toast.success(r("resetDone"));
      router.push("/login");
    } catch (err) {
      toast.error(r("resetFailed"), { description: fieldError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await forgotPassword(email);
      toast.success(r("codeResent"));
    } catch (err) {
      toast.error(r("failed"), { description: fieldError(err) });
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
          {step === "email" ? (
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
          ) : (
            <form onSubmit={submitReset} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">{r("resetTitle")}</h1>
              <p className="text-sm text-slate-400">{r("resetSubtitle").replace("{email}", email)}</p>
              <div className="py-2">
                <OtpInput value={otp} onChange={setOtp} autoFocus />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{r("newPassword")}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <Button type="submit" disabled={busy || otp.length < 6} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("resetCta")}
              </Button>
              <button type="button" onClick={resend} className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800">
                {r("resend")}
              </button>
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

function fieldError(err: unknown): string | undefined {
  if (err instanceof ApiError && err.errors) {
    return Object.values(err.errors).flat()[0];
  }
  return err instanceof Error ? err.message : undefined;
}
