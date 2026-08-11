"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { login } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { activateCompany } from "@/lib/api/activation";
import { OtpInput } from "@/components/ui/otp-input";
import { SuspendedScreen, type SuspendedInfo } from "@/components/auth/suspended-screen";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("manager@fleet.de");
  const [password, setPassword] = useState("password");
  const [submitting, setSubmitting] = useState(false);
  const [suspended, setSuspended] = useState<SuspendedInfo | null>(null);
  const [activateMode, setActivateMode] = useState(false);
  const [code, setCode] = useState("");

  async function goAfterLogin() {
    const u = await login(email, password);
    router.push(u.roles.includes("super_admin") ? "/admin" : "/dashboard");
  }

  async function onActivate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await activateCompany(email, password, code.trim());
      await goAfterLogin();
    } catch (err) {
      const s = (k: string) => t(`suspended.${k}`);
      toast.error(s("activateFailed"), { description: apiErrorMessage(err, t) });
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const u = await login(email, password);
      // Super-admins land on the platform panel; managers on their dashboard.
      router.push(u.roles.includes("super_admin") ? "/admin" : "/dashboard");
    } catch (err) {
      // A suspended company (disabled/banned/expired) → the contact/activate screen.
      if (err instanceof ApiError && err.status === 403 && err.data?.reason) {
        setSuspended({
          reason: err.data.reason as SuspendedInfo["reason"],
          email,
          password,
          supportEmail: err.data.support_email as string | null,
          supportWhatsapp: err.data.support_whatsapp as string | null,
        });
        setSubmitting(false);
        return;
      }
      const message =
        err instanceof ApiError && err.status === 422
          ? t("login.invalid")
          : "API offline (:8090)?";
      toast.error(t("login.failed"), { description: message });
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={72} className="text-slate-900" />
          <div className="leading-tight">
            <div className="text-lg font-bold text-slate-900">Reidey</div>
            <div className="text-xs text-slate-400">Fleet Management</div>
          </div>
        </div>

        {suspended ? (
          <SuspendedScreen
            info={suspended}
            onActivated={() => {
              setSuspended(null);
              onSubmit(new Event("submit") as unknown as React.FormEvent);
            }}
          />
        ) : activateMode ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">{t("suspended.activateTitle")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("suspended.activateHint")}</p>
            <form className="mt-5 space-y-4" onSubmit={onActivate}>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("login.email")}</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("login.password")}</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </div>
              <div className="py-1">
                <OtpInput value={code} onChange={setCode} autoFocus />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || code.length < 6}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("suspended.activateCta")}
              </Button>
              <button type="button" onClick={() => setActivateMode(false)}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800">
                {t("suspended.backToLogin")}
              </button>
            </form>
          </div>
        ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("login.subtitle")}</p>

          <form className="mt-5 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("login.email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-700">{t("login.password")}</label>
                <Link href="/forgot-password" className="text-xs font-medium text-slate-500 hover:text-slate-800">
                  {t("login.forgotCta")}
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? t("login.signingIn") : t("login.signIn")}
            </Button>
            <button type="button" onClick={() => setActivateMode(true)}
              className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800">
              {t("suspended.haveCode")}
            </button>
          </form>
        </div>
        )}

        <p className="mt-4 text-center text-sm text-slate-500">
          {t("login.noAccount")}{" "}
          <Link href="/register" className="font-medium text-slate-900 hover:underline">
            {t("login.registerCta")}
          </Link>
        </p>
      </div>
    </div>
  );
}
