"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Landmark, Banknote, MessageCircle, Copy, Check, Loader2, Clock, Wallet } from "lucide-react";
import { formatMoney, toLatinDigits } from "@/lib/utils";
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
  const { t, locale } = useI18n();
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

  const bankAmount = methods.bank?.amount ? Number(methods.bank.amount) : null;
  const epc =
    methods.bank && canBuildEpc({ name: methods.bank.holder, iban: methods.bank.iban })
      ? buildEpcPayload({
          name: methods.bank.holder ?? "",
          iban: methods.bank.iban ?? "",
          bic: methods.bank.bic,
          amountEur: bankAmount, // prefills the amount in the scanned bank transfer
          reference, // the company's unique reference lands in the transfer's note
        })
      : null;

  const body = (
    <div className="stack-lg">
      {!headless && (
        <h2 className="section-title row" style={{ gap: 8 }}>
          <span className="subtle"><Wallet style={{ width: 18, height: 18 }} /></span>
          {c("payTitle")}
        </h2>
      )}
      <p className="muted text-sm">{c("paySubtitle")}</p>

      {/* The company's stable reference — quoted on the transfer + to support. */}
      {reference && (
        <div className="acc-ref">
          <div>
            <div className="subtle text-xs strong" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>{c("yourReference")}</div>
            <div className="code">{reference}</div>
            <div className="text-sm muted" style={{ marginTop: 4 }}>{c("referenceHint")}</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={copyRef}>
            {copied ? <Check /> : <Copy />}
            {c("copy")}
          </button>
        </div>
      )}

      {/* "I've paid" — files a claim the admin verifies by the reference. */}
      {onConfirm && (
        <div className="acc-claim">
          {claimPending ? (
            <div className="acc-pending">
              <Clock />
              <span>{c("claimPendingLabel")}</span>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={confirming}>
                {confirming ? <Loader2 style={{ animation: "ofr-spin 1s linear infinite" }} /> : <Check />}
                {c("confirmPayment")}
              </button>
              <span className="subtle text-sm" style={{ maxWidth: "46ch" }}>{c("confirmPaymentHint")}</span>
            </>
          )}
        </div>
      )}

      {methods.bank && (
        <div className="acc-method">
          <h3>
            <span className="stat-ico info"><Landmark /></span>
            {c("payBank")}
          </h3>
          <div className="acc-pay">
            <div className="stack">
              <dl className="kv">
                <Row label={c("payBankHolder")} value={methods.bank.holder} />
                <Row label={c("payBankName")} value={methods.bank.bank} />
                <Row label={c("payBankIban")} value={methods.bank.iban} mono />
                <Row label={c("payBankBic")} value={methods.bank.bic} mono />
                {bankAmount ? <Row label={c("payBankAmount")} value={formatMoney(bankAmount, locale)} bold /> : null}
              </dl>
              {methods.bank.note && <p className="subtle text-sm">{methods.bank.note}</p>}
            </div>
            {epc && (
              <div className="stack-sm">
                <div className="acc-qr">
                  <QRCodeSVG value={epc} size={140} marginSize={0} style={{ width: "100%", height: "auto" }} />
                </div>
                <p className="text-xs subtle">{c("scanToPay")}</p>
                <p className="text-xs subtle">{c("scanToPayHint")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {methods.cash && (
        <div className="acc-method">
          <h3>
            <span className="stat-ico success"><Banknote /></span>
            {c("payCash")}
          </h3>
          {cashDigits && (
            <a href={`https://wa.me/${cashDigits}`} target="_blank" rel="noopener noreferrer" className="acc-pill">
              <MessageCircle />
              <span dir="ltr">{toLatinDigits(methods.cash.whatsapp ?? "")}</span>
            </a>
          )}
          {methods.cash.note && <span className="subtle text-sm">{methods.cash.note}</span>}
        </div>
      )}
    </div>
  );

  if (headless) return <div className={className}>{body}</div>;

  return <section className={`card ${className}`}><div className="card-body">{body}</div></section>;
}

function Row({ label, value, mono = false, bold = false }: { label: string; value: string | null; mono?: boolean; bold?: boolean }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : bold ? "num strong" : undefined} dir={mono ? "ltr" : undefined}>
        {mono ? toLatinDigits(value) : value}
      </dd>
    </>
  );
}
