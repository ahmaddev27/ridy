"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, X, Send, HandCoins, Inbox } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { formatMoney, latnLocale } from "@/lib/utils";
import { PAYMENT_METHOD_KEYS, paymentMethodLabel } from "@/lib/api/payments";
import { ADMIN_BADGES_REFRESH_EVENT } from "@/components/layout/app-feeds";
import {
  listPaymentClaims,
  resolvePaymentClaim,
  listPlans,
  type PaymentClaim,
  type PaymentClaimStatus,
  type Plan,
} from "@/lib/api/admin";
import { apiErrorMessage } from "@/lib/api/error-message";

type Filter = "pending" | "confirmed" | "rejected" | "all";

const STATUS_TONE: Record<PaymentClaimStatus, string> = {
  pending: "warning",
  confirmed: "success",
  rejected: "danger",
};

/**
 * Admin list of company "I've paid" claims with their lifecycle status — the
 * review queue (pending, with accept/reject) plus the archive (confirmed/rejected
 * keep their status + reason). Accepting picks a plan → issues + emails a code;
 * rejecting requires a reason → emails it.
 */
export function PaymentClaimsList() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.claims.${k}`);
  const [filter, setFilter] = useState<Filter>("pending");
  const [claims, setClaims] = useState<PaymentClaim[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [cl, pl] = await Promise.all([listPaymentClaims(filter), listPlans()]);
      setClaims(cl);
      setPlans(pl.filter((p) => p.active));
    } catch {
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(latnLocale(locale)) : "—");

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <span className="subtle"><HandCoins style={{ width: 18, height: 18 }} /></span>
          {c("title")}
        </h2>
        <div className="seg" role="group">
          {(["pending", "confirmed", "rejected", "all"] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {c(`filter_${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="card-body">
        {loading ? (
          <div className="stack-sm">
            {[0, 1].map((i) => <div key={i} className="skel" style={{ height: 64, borderRadius: 12 }} />)}
          </div>
        ) : claims.length === 0 ? (
          <div className="empty">
            <span className="empty-ico"><Inbox /></span>
            <h3>{c("empty")}</h3>
          </div>
        ) : (
          <div className="stack-sm">
            {claims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} plans={plans} onResolved={() => { load(); window.dispatchEvent(new Event(ADMIN_BADGES_REFRESH_EVENT)); }} whenText={date(claim.created_at)} resolvedText={date(claim.resolved_at)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ClaimRow({
  claim,
  plans,
  onResolved,
  whenText,
  resolvedText,
}: {
  claim: PaymentClaim;
  plans: Plan[];
  onResolved: () => void;
  whenText: string;
  resolvedText: string;
}) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.claims.${k}`);
  const [mode, setMode] = useState<null | "accept" | "reject">(null);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState("");
  const [method, setMethod] = useState<string>("bank");
  const [reason, setReason] = useState("");

  const pending = claim.status === "pending";

  async function accept() {
    setBusy(true);
    try {
      await resolvePaymentClaim(claim.id, { status: "confirmed", plan_id: Number(planId), paid: true, payment_method: method });
      toast.success(c("accepted"));
      onResolved();
    } catch (e) {
      toast.error(c("resolveFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await resolvePaymentClaim(claim.id, { status: "rejected", reason: reason.trim() });
      toast.success(c("rejected"));
      onResolved();
    } catch (e) {
      toast.error(c("resolveFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setBusy(false);
    }
  }

  const panel = { marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" } as const;

  return (
    <div className="card inset" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="strong">{claim.company ?? "—"}</span>
            <span className={`badge ${STATUS_TONE[claim.status]}`}>
              <span className="dot" />
              {c(`st_${claim.status}`)}
            </span>
          </div>
          <div className="subtle text-sm" style={{ marginTop: 3 }}>
            <span className="mono" dir="ltr">{claim.reference}</span>
            <span className="num" dir="ltr"> · {whenText}</span>
            {!pending && claim.resolved_by && <span> · {c("resolvedBy")} {claim.resolved_by} (<span className="num">{resolvedText}</span>)</span>}
          </div>
          {!pending && claim.reason && <div className="muted text-sm" style={{ marginTop: 6 }}>{claim.reason}</div>}
        </div>
        {pending && mode === null && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setMode("reject")} disabled={busy}>
              <X /> {c("reject")}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setMode("accept")} disabled={busy}>
              <Check /> {c("accept")}
            </button>
          </div>
        )}
      </div>

      {pending && mode === "accept" && (
        <div style={panel}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor={`ac-plan-${claim.id}`}>{c("plan")}</label>
              <select id={`ac-plan-${claim.id}`} className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">{c("selectPlan")}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price, locale)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`ac-art-${claim.id}`}>{c("method")}</label>
              <select id={`ac-art-${claim.id}`} className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHOD_KEYS.map((m) => (
                  <option key={m} value={m}>{paymentMethodLabel(m, t)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={accept} disabled={busy || !planId}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />} {c("acceptCta")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode(null)} disabled={busy}>{c("cancel")}</button>
          </div>
        </div>
      )}

      {pending && mode === "reject" && (
        <div style={panel}>
          <div className="field">
            <label htmlFor={`rj-${claim.id}`}>{c("reason")}</label>
            <input
              id={`rj-${claim.id}`}
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={c("reasonPlaceholder")}
            />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={reject} disabled={busy || reason.trim().length === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />} {c("rejectCta")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode(null)} disabled={busy}>{c("cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
