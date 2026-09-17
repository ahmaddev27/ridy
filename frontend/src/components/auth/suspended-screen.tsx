"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, Mail, KeyRound, Banknote, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 */
export function SuspendedScreen({
  info,
  onActivated,
}: {
  info: SuspendedInfo;
  onActivated: () => void;
}) {
  const { t } = useI18n();
  const s = (k: string) => t(`suspended.${k}`);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [claimPending, setClaimPending] = useState(!!info.paymentClaimPending);

  const canActivate = info.reason === "expired" || info.reason === "inactive";

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
    <div className="space-y-3">
      <div className="rounded-lg bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger-fg">
        {s(`reason_${info.reason}`)}
      </div>

      {canActivate ? (
        <>
          <Section title={t("screens.codes.payTitle")} icon={Banknote} defaultOpen>
            <PaymentMethods
              headless
              reference={info.paymentReference}
              claimPending={claimPending}
              onConfirm={confirmPayment}
              confirming={confirming}
            />
          </Section>

          <Section title={s("activateTitle")} icon={KeyRound} defaultOpen={false}>
            <p className="text-xs text-ink-subtle">{s("activateHint")}</p>
            <form onSubmit={activate} className="mt-3 space-y-3">
              <OtpInput value={code} onChange={setCode} autoFocus={false} />
              <Button type="submit" disabled={busy || code.length < 6} className="w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {s("activateCta")}
              </Button>
            </form>
          </Section>
        </>
      ) : (
        <p className="text-sm text-ink-muted">{s("contactHint")}</p>
      )}

      {(wa || info.supportEmail) && (
        <div className="flex flex-col gap-2 pt-1">
          {canActivate && <p className="text-center text-xs text-ink-subtle">{s("contactHint")}</p>}
          {wa && (
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <MessageCircle className="h-4 w-4" /> {s("whatsapp")}
            </a>
          )}
          {info.supportEmail && (
            <a
              href={`mailto:${info.supportEmail}`}
              className="flex items-center justify-center gap-2 rounded-lg border border-line-strong px-3 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              <Mail className="h-4 w-4" /> {s("email")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** A single collapsible section with an icon header and a chevron. */
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
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-start transition-colors hover:bg-surface-2"
      >
        <Icon className="h-4 w-4 shrink-0 text-ink" />
        <span className="flex-1 font-semibold text-ink">{title}</span>
        <ChevronDown className={"h-4 w-4 shrink-0 text-ink-subtle transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}
