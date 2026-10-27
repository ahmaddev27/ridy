"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Fingerprint, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { login, fetchMe } from "@/lib/api/auth";
import type { AuthUser } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { activateCompany } from "@/lib/api/activation";
import { passkeyLogin, passkeyLoginOptions } from "@/lib/api/webauthn";
import { usePasskeySupport } from "@/hooks/use-passkey-support";
import { PasskeyCancelledError, getPasskey } from "@/lib/webauthn";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { SuspendedScreen, type SuspendedInfo } from "@/components/auth/suspended-screen";
import { WhatsAppButton } from "@/components/support/whatsapp-button";
import { AuthLayout } from "@/components/auth/auth-layout";

// No card — the form sits directly on the form column (per design).
const CARD = "";
const INPUT =
  "w-full rounded-lg border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20";

/** Where a signed-in user belongs, by role. */
function homeFor(u: AuthUser): string {
  return u.roles.includes("super_admin") ? "/admin" : u.roles.includes("reseller") ? "/reseller" : "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  // Already-authenticated users must not see the login form — bounce them to
  // their home. Show a loader until that check resolves so the form never flashes.
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suspended, setSuspended] = useState<SuspendedInfo | null>(null);
  const [activateMode, setActivateMode] = useState(false);
  const [code, setCode] = useState("");
  // Not known until after hydration (the prerendered HTML can't tell), so the
  // button only ever appears on browsers that can actually use it.
  const passkeyAvailable = usePasskeySupport() === true;
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((me) => {
        if (active) router.replace(homeFor(me.user));
      })
      .catch(() => {
        // Not signed in (401) — show the login form.
        if (!active) return;
        setCheckingSession(false);
        // Sent here by the app because the session ended or the company was
        // suspended mid-session — say why instead of a silent bounce.
        const reason = new URLSearchParams(window.location.search).get("reason");
        if (reason === "expired") toast.info(t("login.sessionExpired"));
        if (reason === "suspended") toast.warning(t("login.sessionSuspended"));
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function goAfterLogin() {
    const u = await login(email, password, remember);
    router.push(homeFor(u));
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

  /** A suspended company (disabled/banned/expired) → the contact/activate screen.
   *  False when the error is anything else. Shared by the password and passkey sign-ins. */
  function showSuspended(err: unknown): boolean {
    if (!(err instanceof ApiError && err.status === 403 && err.data?.reason)) return false;
    setSuspended({
      reason: err.data.reason as SuspendedInfo["reason"],
      email,
      password,
      supportEmail: err.data.support_email as string | null,
      supportWhatsapp: err.data.support_whatsapp as string | null,
      paymentReference: (err.data.payment_reference as string | null) ?? null,
      paymentClaimPending: !!err.data.payment_claim_pending,
    });
    return true;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const u = await login(email, password, remember);
      // Super-admins land on the platform panel; managers on their dashboard.
      router.push(homeFor(u));
    } catch (err) {
      if (showSuspended(err)) {
        setSubmitting(false);
        return;
      }
      const message =
        err instanceof ApiError && err.status === 422
          ? t("login.invalid")
          : apiErrorMessage(err, t);
      toast.error(t("login.failed"), { description: message });
      setSubmitting(false);
    }
  }

  async function onPasskeySignIn() {
    setPasskeyBusy(true);
    try {
      const { ceremony_id, options } = await passkeyLoginOptions();
      const u = await passkeyLogin(ceremony_id, await getPasskey(options));
      // Same landing as the password sign-in; stays busy until the navigation happens.
      router.push(homeFor(u));
    } catch (err) {
      setPasskeyBusy(false);
      // Dismissing the browser prompt is a choice, not an error.
      if (err instanceof PasskeyCancelledError || showSuspended(err)) return;
      // The backend rejects every bad passkey alike on purpose; only throttling
      // and outages are worth telling apart from the generic message.
      const transient = err instanceof ApiError && (err.status === 429 || err.status >= 500);
      toast.error(t("login.failed"), {
        description: transient ? apiErrorMessage(err, t) : t("login.passkeyFailed"),
      });
    }
  }

  // While confirming an existing session, show a loader instead of the form so
  // an already-authenticated visitor never flashes the login screen.
  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4">
        <Loader2 className="h-6 w-6 animate-spin text-ink-subtle" />
      </div>
    );
  }

  return (
    <AuthLayout panelTitle={t("login.panelTitle")} panelSubtitle={t("login.panelSubtitle")}>
      {suspended ? (
        <SuspendedScreen
          info={suspended}
          onActivated={() => {
            setSuspended(null);
            onSubmit(new Event("submit") as unknown as React.FormEvent);
          }}
          onBackToLogin={() => setSuspended(null)}
        />
      ) : activateMode ? (
        <div className={CARD}>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t("suspended.activateTitle")}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">{t("suspended.activateHint")}</p>
          <form className="mt-6 space-y-4" onSubmit={onActivate}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">{t("login.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">{t("login.password")}</label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="py-1">
              <OtpInput value={code} onChange={setCode} autoFocus />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || code.length < 6}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("suspended.activateCta")}
            </Button>
            <button type="button" onClick={() => setActivateMode(false)}
              className="w-full text-center text-xs font-medium text-ink-muted hover:text-ink">
              {t("suspended.backToLogin")}
            </button>
          </form>
        </div>
      ) : (
        <div className={CARD}>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t("login.title")}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">{t("login.subtitle")}</p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">{t("login.email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-sm font-medium text-ink">{t("login.password")}</label>
                <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                  {t("login.forgotCta")}
                </Link>
              </div>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-line-strong accent-primary focus:ring-2 focus:ring-primary/20"
              />
              {t("login.remember")}
            </label>
            <Button type="submit" className="w-full" disabled={submitting || passkeyBusy}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? t("login.signingIn") : t("login.signIn")}
            </Button>
            <button type="button" onClick={() => setActivateMode(true)}
              className="w-full text-center text-xs font-medium text-ink-muted hover:text-ink">
              {t("suspended.haveCode")}
            </button>
          </form>

          {passkeyAvailable && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-ink-subtle">
                <span className="h-px flex-1 bg-line" />
                {t("login.or")}
                <span className="h-px flex-1 bg-line" />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={onPasskeySignIn}
                disabled={submitting || passkeyBusy}
              >
                {passkeyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                {passkeyBusy ? t("login.signingIn") : t("login.passkeySignIn")}
              </Button>
            </>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        {t("login.noAccount")}{" "}
        <Link href="/register" className="font-semibold text-primary hover:underline">
          {t("login.registerCta")}
        </Link>
      </p>

      <div className="mt-4 flex justify-center">
        <WhatsAppButton />
      </div>
    </AuthLayout>
  );
}
