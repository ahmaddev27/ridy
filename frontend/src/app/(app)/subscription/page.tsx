"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import { ReceiptText, KeyRound, Info, History } from "lucide-react";
import { PageHead, SkelRows } from "@/components/ui/rd";
import { EmptyState } from "@/components/ui/empty-state";
import { RedeemCodeModal } from "@/components/subscription/redeem-code-modal";
import { PaymentMethods } from "@/components/subscription/payment-methods";
import { paymentMethodLabel, getPaymentReference, submitPaymentClaim } from "@/lib/api/payments";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getCompanySubscriptions, type CompanySubscriptionRow } from "@/lib/api/company-subscription";

const PERIOD_TONE: Record<CompanySubscriptionRow["period_status"], string> = {
  active: "success",
  scheduled: "warning",
  ended: "",
};

export default function CompanySubscriptionPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.codes.${k}`);
  const r_ = (k: string) => t(`screens.remake.${k}`);
  const { data, loading, refetch } = useAsync(getCompanySubscriptions);
  const rows = data ?? [];

  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [claimPending, setClaimPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    getPaymentReference()
      .then((r) => {
        setReference(r.reference);
        setClaimPending(r.claim_pending);
      })
      .catch(() => {});
  }, []);

  async function confirmPayment() {
    setConfirming(true);
    try {
      await submitPaymentClaim();
      setClaimPending(true);
      toast.success(c("claimSent"));
    } catch {
      toast.error(c("claimFailed"));
    } finally {
      setConfirming(false);
    }
  }

  const money = (n: number | null) =>
    n === null ? "—" : new Intl.NumberFormat(latnLocale(locale), { style: "currency", currency: "EUR" }).format(n);
  const date = (iso: string) => toLatinDigits(new Date(iso).toLocaleDateString(latnLocale(locale)));

  const active = rows.find((r) => r.period_status === "active") ?? null;
  const queued = rows.filter((r) => r.period_status === "scheduled");

  return (
    <>
      <PageHead
        title={t("pages.companySubscription.title")}
        sub={t("pages.companySubscription.subtitle")}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            <KeyRound />
            {c("redeem")}
          </button>
        }
      />

      <RedeemCodeModal open={open} onClose={() => setOpen(false)} onSuccess={refetch} />

      <div className="acc-split">
        <div className="stack">
          <PaymentMethods reference={reference} claimPending={claimPending} onConfirm={confirmPayment} confirming={confirming} />
        </div>
        <div className="stack">
          {active && <StatusCard active={active} queued={queued} date={date} c={c} onRedeem={() => setOpen(true)} />}
          <div className="callout info">
            <Info />
            <div>{r_("subInfo")}</div>
          </div>
        </div>
      </div>

      <section className="card table-card">
        <div className="card-head">
          <div className="truncate">
            <h2 className="row" style={{ gap: 8 }}>
              <span className="subtle">
                <History style={{ width: 18, height: 18 }} />
              </span>
              {r_("subHistory")}
            </h2>
            <div className="sub">{r_("subHistorySub")}</div>
          </div>
        </div>
        {loading ? (
          <SkelRows rows={4} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title={c("empty")} description={c("emptyDesc")} />
        ) : (
          <div className="table-wrap">
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{c("colPlan")}</th>
                  <th>{c("colCode")}</th>
                  <th>{c("colRef")}</th>
                  <th>{c("method")}</th>
                  <th>{c("colCollector")}</th>
                  <th className="r">{c("colAmount")}</th>
                  <th>{c("colStatus")}</th>
                  <th>{c("colPeriod")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="strong">{r.plan ?? c("free")}</td>
                    <td>
                      {r.code ? <span className="mono" style={{ letterSpacing: ".08em" }} dir="ltr">{r.code}</span> : <span className="subtle">—</span>}
                    </td>
                    <td>
                      {r.payment_ref ? <span className="mono text-xs" dir="ltr">{r.payment_ref}</span> : <span className="subtle">—</span>}
                    </td>
                    <td>{paymentMethodLabel(r.payment_method, t)}</td>
                    <td>{r.collector ?? "—"}</td>
                    <td className="r">
                      <span className="nowrap num">
                        {money(r.amount)}
                        <span className="text-xs" style={{ marginInlineStart: 6, color: r.paid ? "var(--success-fg)" : "var(--ink-subtle)" }}>
                          · {r.paid ? c("paid") : c("unpaid")}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${PERIOD_TONE[r.period_status]}`}>
                        <span className="dot" />
                        {c(`st_${r.period_status}`)}
                      </span>
                    </td>
                    <td>
                      <span className="num nowrap" dir="ltr">
                        {date(r.starts_at)} - {date(r.ends_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** Current subscription status, derived from the ledger's active/scheduled periods. */
function StatusCard({
  active,
  queued,
  date,
  c,
  onRedeem,
}: {
  active: CompanySubscriptionRow;
  queued: CompanySubscriptionRow[];
  date: (iso: string) => string;
  c: (k: string) => string;
  onRedeem: () => void;
}) {
  const { t } = useI18n();
  const total = Math.max(1, Math.round((new Date(active.ends_at).getTime() - new Date(active.starts_at).getTime()) / 86_400_000));
  const left = Math.max(0, Math.ceil((new Date(active.ends_at).getTime() - Date.now()) / 86_400_000));
  const R = 40;
  const L = 2 * Math.PI * R;
  const color = left <= 3 ? "var(--danger-dot)" : left <= 7 ? "var(--warning-dot)" : "var(--primary)";
  const queuedDays = queued.reduce((n, q) => n + Math.round((new Date(q.ends_at).getTime() - new Date(q.starts_at).getTime()) / 86_400_000), 0);
  return (
    <section className="card" style={{ padding: 20, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <svg width="104" height="104" viewBox="0 0 96 96" role="img" aria-label={`${left} ${t("screens.remake.daysLeft")}`}>
        <circle cx="48" cy="48" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
        <circle
          cx="48"
          cy="48"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={L}
          strokeDashoffset={L * (1 - Math.min(1, left / total))}
          transform="rotate(-90 48 48)"
        />
        <text x="48" y="50" textAnchor="middle" style={{ font: "650 24px var(--font-sans)", fill: "var(--ink)" }}>{left}</text>
        <text x="48" y="66" textAnchor="middle" style={{ font: "500 10px var(--font-sans)", fill: "var(--ink-subtle)" }}>{t("screens.remake.daysLeft")}</text>
      </svg>
      <div className="stack-sm grow" style={{ minWidth: 200 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="section-title">{t("screens.remake.subStatus")}</h2>
          <span className="badge success">
            <span className="dot" />
            {c("st_active")}
          </span>
        </div>
        <div className="g-2" style={{ gap: 10 }}>
          <div>
            <div className="subtle text-xs">{t("screens.remake.subActivated")}</div>
            <div className="strong num">{date(active.starts_at)}</div>
          </div>
          <div>
            <div className="subtle text-xs">{t("screens.remake.subEnds")}</div>
            <div className="strong num">{date(active.ends_at)}</div>
          </div>
        </div>
        {queued.length > 0 && (
          <span className="text-sm" style={{ color: "var(--info-fg)", background: "var(--info-bg)", padding: "6px 9px", borderRadius: 8, alignSelf: "flex-start" }}>
            +{queuedDays} {t("screens.remake.daysShort")} · {date(queued[0].starts_at)}
          </span>
        )}
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRedeem}>
            <KeyRound />
            {c("redeem")}
          </button>
        </div>
      </div>
    </section>
  );
}
