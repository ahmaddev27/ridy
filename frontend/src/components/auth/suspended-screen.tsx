"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, Mail, KeyRound, Banknote, ChevronDown, Check, Clock, LockKeyhole } from "lucide-react";
import { OtpInput } from "@/components/ui/otp-input";
import { PaymentMethods } from "@/components/subscription/payment-methods";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { activateCompany } from "@/lib/api/activation";
import { submitPaymentClaimWithCredentials } from "@/lib/api/payments";

export type SuspendedInfo = {
  reason: "disabled" | "banned" | "expired" | "inactive";
  email: string;
  password: string;
  supportEmail?: string | null;
  supportWhatsapp?: string | null;
  paymentReference?: string | null;
  paymentClaimPending?: boolean;
};

/**
 * Shown when a company is blocked from signing in. "expired"/"inactive" get two
 * collapsible sections — "How to pay" (reference + bank QR + cash + an "I've paid"
 * button) open by default, and "Have a code?" (enter the activation code) — in the
 * order the company proceeds. "disabled"/"banned" only offer support contact.
 *
 * Both credentialed actions re-send the just-typed email+password to prove account
 * ownership (the visitor is not signed in). After a passkey sign-in there is no
 * typed password, so those actions give way to a "sign in with your password" hint
 * (decision D8); the payment info and support contacts need no credentials and stay.
 */
export function SuspendedScreen({
  info,
  onActivated,
  onBackToLogin,
}: {
  info: SuspendedInfo;
  onActivated: () => void;
  onBackToLogin?: () => void;
}) {
  const { t } = useI18n();
  const s = (k: string) => t(`suspended.${k}`);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [claimPending, setClaimPending] = useState(!!info.paymentClaimPending);

  const canActivate = info.reason === "expired" || info.reason === "inactive";
  const hasCredentials = info.password !== "";

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await activateCompany(info.email, info.password, code.trim());
      toast.success(s("activated"));
      onActivated();
    } catch (err) {
      toast.error(s("activateFailed"), { description: apiErrorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment() {
    setConfirming(true);
    try {
      await submitPaymentClaimWithCredentials(info.email, info.password);
      setClaimPending(true);
      toast.success(t("screens.codes.claimSent"));
    } catch (err) {
      toast.error(t("screens.codes.claimFailed"), { description: apiErrorMessage(err, t) });
    } finally {
      setConfirming(false);
    }
  }

  const wa = info.supportWhatsapp?.replace(/[^\d]/g, "");

  return (
    <div className="stack">
      <div className="callout danger" role="alert">
        <LockKeyhole />
        <div>{s(`reason_${info.reason}`)}</div>
      </div>

      {canActivate ? (
        <>
          <Section title={t("screens.codes.payTitle")} icon={Banknote} defaultOpen>
            <PaymentMethods headless reference={info.paymentReference} />
          </Section>

          {/* "I've paid" stays OUTSIDE the collapse so it's always visible. */}
          {claimPending ? (
            <div className="callout">
              <Clock />
              <div>{t("screens.codes.claimPendingLabel")}</div>
            </div>
          ) : hasCredentials ? (
            <div className="card inset" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={confirmPayment} disabled={confirming}>
                {confirming ? <Loader2 className="animate-spin" /> : <Check />}
                {t("screens.codes.confirmPayment")}
              </button>
              <p className="subtle text-sm">{t("screens.codes.confirmPaymentHint")}</p>
            </div>
          ) : null}

          {hasCredentials ? (
            <Section title={s("activateTitle")} icon={KeyRound}>
              <form onSubmit={activate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <p className="subtle text-sm">{s("activateHint")}</p>
                <OtpInput value={code} onChange={setCode} autoFocus={false} />
                <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length < 6}>
                  {busy && <Loader2 className="animate-spin" />}
                  {s("activateCta")}
                </button>
              </form>
            </Section>
          ) : (
            <div className="card inset" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <p className="text-sm muted">{s("passwordNeededHint")}</p>
            </div>
          )}
        </>
      ) : null}

      <div className="stack-sm" style={{ textAlign: "center" }}>
        {wa && (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg btn-block">
            <MessageCircle /> {s("whatsapp")}
          </a>
        )}
        {info.supportEmail && (
          <a href={`mailto:${info.supportEmail}`} className="btn btn-secondary btn-lg btn-block">
            <Mail /> {s("email")}
          </a>
        )}
        <p className="subtle text-sm">{s("contactHint")}</p>
        {onBackToLogin && (
          <button type="button" className="btn btn-ghost btn-block" onClick={onBackToLogin}>
            {s("backToLogin")}
          </button>
        )}
      </div>
    </div>
  );
}

/** A collapsible section (prototype `.auth-det`) with an icon header and a chevron. */
function Section({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="auth-det" open={defaultOpen}>
      <summary>
        <Icon />
        {title}
        <ChevronDown className="chev" />
      </summary>
      <div className="det-body">{children}</div>
    </details>
  );
}
