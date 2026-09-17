"use client";

import { useEffect, useState } from "react";
import { Landmark, Banknote, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toLatinDigits } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { getPaymentMethods, type PaymentMethods as Methods } from "@/lib/api/payments";

/**
 * "How to pay" block for a company that needs to activate/renew its subscription.
 * Shows only the admin-enabled methods (bank transfer / cash) and renders nothing
 * when none are enabled, so it can be dropped onto both the in-app subscription
 * page and the pre-login suspended screen without a wrapper guard.
 */
export function PaymentMethods({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.codes.${k}`);
  const [methods, setMethods] = useState<Methods | null>(null);

  useEffect(() => {
    let active = true;
    getPaymentMethods()
      .then((m) => {
        if (active) setMethods(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!methods || (!methods.bank && !methods.cash)) return null;

  const cashDigits = methods.cash?.whatsapp?.replace(/\D/g, "") ?? "";

  return (
    <Card className={`p-5 ${className}`}>
      <h3 className="font-semibold text-ink">{c("payTitle")}</h3>
      <p className="mt-1 text-sm text-ink-muted">{c("paySubtitle")}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {methods.bank && (
          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-ink" />
              <span className="font-medium text-ink">{c("payBank")}</span>
            </div>
            <dl className="space-y-2 text-sm">
              <Row label={c("payBankHolder")} value={methods.bank.holder} />
              <Row label={c("payBankName")} value={methods.bank.bank} />
              <Row label={c("payBankIban")} value={methods.bank.iban} mono />
              <Row label={c("payBankBic")} value={methods.bank.bic} mono />
            </dl>
            {methods.bank.note && <p className="mt-3 text-xs text-ink-subtle">{methods.bank.note}</p>}
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
    </Card>
  );
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
