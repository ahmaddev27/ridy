"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Inbox } from "lucide-react";
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

type Filter = "pending" | "confirmed" | "rejected" | "all";

const STATUS_CHIP: Record<PaymentClaimStatus, string> = {
  pending: "bg-warning-bg text-warning-fg",
  confirmed: "bg-success-bg text-success-fg",
  rejected: "bg-danger-bg text-danger-fg",
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
    <Card className="p-5">
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface-2 p-1">
        {(["pending", "confirmed", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (filter === f ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink")
            }
          >
            {c(`filter_${f}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />)}
        </div>
      ) : claims.length === 0 ? (
        <EmptyState icon={Inbox} title={c("empty")} />
      ) : (
        <div className="space-y-2">
          {claims.map((claim) => (
            <ClaimRow key={claim.id} claim={claim} plans={plans} onResolved={() => { load(); window.dispatchEvent(new Event(ADMIN_BADGES_REFRESH_EVENT)); }} whenText={date(claim.created_at)} resolvedText={date(claim.resolved_at)} />
          ))}
        </div>
      )}
    </Card>
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
      toast.error(c("resolveFailed"), { description: e instanceof Error ? e.message : undefined });
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
      toast.error(c("resolveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{claim.company ?? "—"}</span>
            <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + STATUS_CHIP[claim.status]}>
              {c(`st_${claim.status}`)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
            <span className="font-mono" dir="ltr">{claim.reference}</span>
            <span dir="ltr">· {whenText}</span>
            {!pending && claim.resolved_by && <span>· {c("resolvedBy")} {claim.resolved_by} ({resolvedText})</span>}
          </div>
          {!pending && claim.reason && <p className="mt-1 text-xs text-ink-muted">{claim.reason}</p>}
        </div>
        {pending && mode === null && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setMode("reject")} disabled={busy} className="text-sm">
              <X className="h-4 w-4" /> {c("reject")}
            </Button>
            <Button onClick={() => setMode("accept")} disabled={busy} className="text-sm">
              <Check className="h-4 w-4" /> {c("accept")}
            </Button>
          </div>
        )}
      </div>

      {pending && mode === "accept" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-medium text-ink-muted">{c("plan")}</label>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink"
            >
              <option value="">{c("selectPlan")}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price, locale)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">{c("method")}</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink"
            >
              {PAYMENT_METHOD_KEYS.map((m) => (
                <option key={m} value={m}>{paymentMethodLabel(m, t)}</option>
              ))}
            </select>
          </div>
          <Button onClick={accept} disabled={busy || !planId} className="text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {c("acceptCta")}
          </Button>
          <Button variant="ghost" onClick={() => setMode(null)} disabled={busy} className="text-sm">{c("cancel")}</Button>
        </div>
      )}

      {pending && mode === "reject" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-ink-muted">{c("reason")}</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={c("reasonPlaceholder")}
              className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </div>
          <Button onClick={reject} disabled={busy || reason.trim().length === 0} className="text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} {c("rejectCta")}
          </Button>
          <Button variant="ghost" onClick={() => setMode(null)} disabled={busy} className="text-sm">{c("cancel")}</Button>
        </div>
      )}
    </div>
  );
}
