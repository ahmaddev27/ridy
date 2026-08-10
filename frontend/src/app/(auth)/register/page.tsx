"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { useI18n } from "@/lib/i18n/context";
import { ApiError } from "@/lib/api/client";
import { login } from "@/lib/api/auth";
import { startRegistration, verifyRegistration, resendOtp } from "@/lib/api/register";

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useI18n();
  const r = (k: string) => t(`register.${k}`);

  const [step, setStep] = useState<"form" | "otp">("form");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await startRegistration({ company_name: company, name, email, password });
      toast.success(r("codeSent"), { description: email });
      setStep("otp");
    } catch (err) {
      toast.error(r("failed"), { description: fieldError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyRegistration(email, otp.trim());
      // Verified → the company + account exist; sign in with the chosen password.
      const user = await login(email, password);
      router.push(user.roles.includes("super_admin") ? "/admin" : "/dashboard");
    } catch (err) {
      toast.error(r("verifyFailed"), { description: fieldError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await resendOtp(email);
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
          {step === "form" ? (
            <form onSubmit={submitForm} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">{r("title")}</h1>
              <p className="text-sm text-slate-400">{r("subtitle")}</p>
              <Field label={r("company")} value={company} onChange={setCompany} />
              <Field label={r("name")} value={name} onChange={setName} />
              <Field label={r("email")} type="email" value={email} onChange={setEmail} />
              <Field label={r("password")} type="password" value={password} onChange={setPassword} />
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("createAccount")}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitOtp} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">{r("verifyTitle")}</h1>
              <p className="text-sm text-slate-400">{r("verifySubtitle").replace("{email}", email)}</p>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoFocus
                placeholder="••••••"
                className="w-full rounded-lg border border-slate-300 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-slate-900"
              />
              <Button type="submit" disabled={busy || otp.length < 6} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {r("verify")}
              </Button>
              <button type="button" onClick={resend} className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800">
                {r("resend")}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          {r("haveAccount")}{" "}
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            {r("signIn")}
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
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
      />
    </div>
  );
}
