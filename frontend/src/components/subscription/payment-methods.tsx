"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Landmark, Banknote, MessageCircle, Copy, Check, Loader2, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toLatinDigits } from "@/lib/utils";
import { buildEpcPayload, canBuildEpc } from "@/lib/epc";
import { useI18n } from "@/lib/i18n/context";
import { getPaymentMethods, type PaymentMethods as Methods } from "@/lib/api/payments";

/**
 * "How to pay" block for a company that needs to activate/renew its subscription.
 * Shows the company's stable payment reference (to quote on the transfer), the
 * admin-enabled methods (bank transfer — with a scannable EPC/GiroCode QR — and
 * cash), and an idempotent "I've paid" button. Renders nothing when no method is
 * enabled. `headless` drops the outer Card + title so a parent (e.g. a collapsible
 * section) can supply its own header.
 */
export function PaymentMethods({
  reference,
  claimPending = false,
  onConfirm,
  confirming = false,
  headless = false,
  className = "",
}: {
  reference?: string | null;
  claimPending?: boolean;
  onConfirm?: () => void;
  confirming?: boolean;
  headless?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.codes.${k}`);
  const [methods, setMethods] = useState<Methods | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    getPaymentMethods()
      .then((m) => active && setMethods(m))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!methods || (!methods.bank && !methods.cash)) return null;

  const cashDigits = methods.cash?.whatsapp?.replace(/\D/g, "") ?? "";

  const copyRef = async () => {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const epc =
    methods.bank && canBuildEpc({ name: methods.bank.holder, iban: methods.bank.iban })
      ? buildEpcPayload({
          name: methods.bank.holder ?? "",
          iban: methods.bank.iban ?? "",
          bic: methods.bank.bic,
          reference,
        })
      : null;

  const body = (
    <>
      {!headless && <h3 className="font-semibold text-ink">{c("payTitle")}</h3>}
      <p className={"text-sm text-ink-muted " + (headless ? "" : "mt-1")}>{c("paySubtitle")}</p>

      {/* The company's stable reference — quoted on the transfer + to support. */}
      {reference && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-xs font-medium text-ink-muted">{c("yourReference")}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-lg font-bold tracking-wider text-ink" dir="ltr">{reference}</span>
            <button
              type="button"
              onClick={copyRef}
              title={c("copy")}
              className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              {copied ? <Check className="h-4 w-4 text-success-fg" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-subtle">{c("referenceHint")}</p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {methods.bank && (
          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-ink" />
              <span className="font-medium text-ink">{c("payBank")}</span>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <dl className="space-y-2 text-sm">
                  <Row label={c("payBankHolder")} value={methods.bank.holder} />
                  <Row label={c("payBankName")} value={methods.bank.bank} />
                  <Row label={c("payBankIban")} value={methods.bank.iban} mono />
                  <Row label={c("payBankBic")} value={methods.bank.bic} mono />
                </dl>
                {methods.bank.note && <p className="mt-3 text-xs text-ink-subtle">{methods.bank.note}</p>}
              </div>
              {epc && (
                <div className="flex shrink-0 flex-col items-center gap-2 self-center border-t border-line pt-4 sm:self-start sm:border-s sm:border-t-0 sm:pt-0 sm:ps-4">
                  <div className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-line">
                    <QRCodeSVG value={epc} size={132} marginSize={0} />
                  </div>
                  <span className="text-xs text-ink-subtle">{c("scanToPay")}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {methods.cash && (
          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 flex items-center gap-2">
              <Banknote className="h-4 w-4 text-ink" />
              <span className="font-medium text-ink">{c("payCash")}</span>
            </div>
            {cashDigits && (
              <a
                href={`https://wa.me/${cashDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                <span dir="ltr">{toLatinDigits(methods.cash.whatsapp ?? "")}</span>
              </a>
            )}
            {methods.cash.note && <p className="mt-3 text-xs text-ink-subtle">{methods.cash.note}</p>}
          </div>
        )}
      </div>

      {/* "I've paid" — files a claim the admin verifies by the reference. */}
      {onConfirm && (
        <div className="mt-4 border-t border-line pt-4">
          {claimPending ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-muted">
              <Clock className="h-4 w-4 text-ink-subtle" />
              {c("claimPendingLabel")}
            </div>
          ) : (
            <>
              <Button onClick={onConfirm} disabled={confirming} className="w-full sm:w-auto">
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {c("confirmPayment")}
              </Button>
              <p className="mt-2 text-xs text-ink-subtle">{c("confirmPaymentHint")}</p>
            </>
          )}
        </div>
      )}
    </>
  );

  if (headless) return <div className={className}>{body}</div>;

  return <Card className={`p-5 ${className}`}>{body}</Card>;
}

function Row({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className={`text-end text-ink ${mono ? "font-mono text-xs" : ""}`} dir={mono ? "ltr" : undefined}>
        {mono ? toLatinDigits(value) : value}
      </dd>
    </div>
  );
}
