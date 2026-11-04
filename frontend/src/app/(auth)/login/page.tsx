"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Fingerprint, Info, Loader2, TriangleAlert, X } from "lucide-react";
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
import { SuspendedScreen, type SuspendedInfo } from "@/components/auth/suspended-screen";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthField } from "@/components/auth/auth-field";

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
  // Why the visitor was sent here (session ended / company paused) — a dismissible callout.
  const [notice, setNotice] = useState<"expired" | "suspended" | null>(null);
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
        if (reason === "expired" || reason === "suspended") setNotice(reason);
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

  const heading = suspended
    ? { title: t("screens.remake.suspendedTitle"), subtitle: t("screens.remake.suspendedSub") }
    : activateMode
      ? { title: t("suspended.activateTitle"), subtitle: t("suspended.activateHint") }
      : { title: t("login.title"), subtitle: t("login.subtitle") };

  return (
    <AuthLayout
      title={heading.title}
      subtitle={heading.subtitle}
      panelTitle={t("login.panelTitle")}
      panelSubtitle={t("login.panelSubtitle")}
    >
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
        <form onSubmit={onActivate}>
          <AuthField label={t("login.email")} type="email" value={email} onChange={setEmail} />
          <AuthField label={t("login.password")} type="password" value={password} onChange={setPassword} />
          <OtpInput value={code} onChange={setCode} autoFocus />
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting || code.length < 6}>
            {submitting && <Loader2 className="animate-spin" />}
            {t("suspended.activateCta")}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setActivateMode(false)}>
            {t("suspended.backToLogin")}
          </button>
        </form>
      ) : (
        <form onSubmit={onSubmit}>
          {notice && (
            <div className={`callout ${notice === "expired" ? "info" : "warning"}`} role="status">
              {notice === "expired" ? <Info /> : <TriangleAlert />}
              <div className="grow">{notice === "expired" ? t("login.sessionExpired") : t("login.sessionSuspended")}</div>
              <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setNotice(null)}>
                <X />
              </button>
            </div>
          )}
          <AuthField label={t("login.email")} type="email" value={email} onChange={setEmail} />
          <AuthField
            className="fgt"
            label={t("login.password")}
            type="password"
            value={password}
            onChange={setPassword}
            hint={
              <Link className="link" href="/forgot-password">
                {t("login.forgotCta")}
              </Link>
            }
          />
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>{t("login.remember")}</span>
          </label>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting || passkeyBusy}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? t("login.signingIn") : t("login.signIn")}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setActivateMode(true)}>
            {t("suspended.haveCode")}
          </button>
          {passkeyAvailable && (
            <>
              <div className="divider-text">{t("login.or")}</div>
              <button
                type="button"
                className="btn btn-secondary btn-lg btn-block"
                onClick={onPasskeySignIn}
                disabled={submitting || passkeyBusy}
              >
                {passkeyBusy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
                {passkeyBusy ? t("login.signingIn") : t("login.passkeySignIn")}
              </button>
            </>
          )}
          <p className="foot-line">
            {t("login.noAccount")}{" "}
            <Link href="/register" className="link">
              {t("login.registerCta")}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
