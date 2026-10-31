"use client";

import { useEffect, useState } from "react";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { dispatchRejectOffer, type DispatchOffer } from "@/lib/api/offers";

/**
 * How long "sent" may stand before we stop asserting it. The confirmation comes
 * from the offer itself (`dispatch_rejected_at`, carried in by this page's Reverb
 * refresh), so anything still missing it after this long did not reach Uber — and
 * a decline that did not happen must never keep looking like one that did.
 */
const CONFIRM_GRACE_MS = 12_000;

/** Null = nothing sent yet; "waiting" = asked, no answer; "lapsed" = no answer in time. */
type Sent = null | "waiting" | "lapsed";

/**
 * Decline one pending offer through the fleet's own Uber dispatch session, so it
 * never counts against the driver's Uber acceptance rate.
 *
 * The button appears only while the SERVER says it would take the request
 * (`can_decline`) — the window is never guessed here — and the outcome is read
 * back off the offer rather than from the response, which only confirms queuing.
 */
export function DeclineOfferButton({ offer }: { offer: DispatchOffer }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.offers.${k}`);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent>(null);
  const age = useOfferAge(offer.received_at);
  const pastDeadline = usePastDeadline(offer.decline_deadline ?? null);

  useEffect(() => {
    if (sent !== "waiting") return;
    const timer = setTimeout(() => setSent("lapsed"), CONFIRM_GRACE_MS);
    return () => clearTimeout(timer);
  }, [sent]);

  async function decline() {
    setBusy(true);
    try {
      const result = await dispatchRejectOffer(offer.id);
      // A refusal is a 200 with a reason: the server's verdict, not a failed
      // request, so the operator gets the reason rather than an error.
      if (result.status === "refused") {
        toast.error(c("declineFailed"), { description: refusalText(c, result.reason) });
        return;
      }
      if (result.status === "queued") toast.success(c("declineQueuedToast"));
      setSent("waiting");
    } catch (e) {
      toast.error(c("declineFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setBusy(false);
    }
  }

  // Uber took it: the status badge says so, so this control has nothing to add.
  if (offer.dispatch_rejected_at) return null;

  const declinable = offer.status === "pending" && offer.can_decline === true && !pastDeadline;
  if (!declinable && sent === null) return null;

  if (busy || sent === "waiting") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-subtle">
        {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
        {c(busy ? "declineBusy" : "declineSent")}
      </span>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {sent === "lapsed" && (
        <span className="whitespace-nowrap text-xs font-medium text-warning-fg">{c("declineUnconfirmed")}</span>
      )}
      {age != null && (
        <span
          title={c("offerAgeHint")}
          className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-subtle"
        >
          {Math.min(age, 99)}
          {age > 99 ? "+" : ""}s
        </span>
      )}
      <Button
        variant="danger"
        size="sm"
        onClick={(e) => {
          e.stopPropagation(); // the row itself opens the offer detail
          void decline();
        }}
        disabled={!declinable}
      >
        <Ban className="h-3.5 w-3.5" />
        {c("decline")}
      </Button>
    </div>
  );
}

/** A refusal reason is a stable snake_case code; an unmapped one falls back. */
function refusalText(c: (key: string) => string, reason?: string): string {
  if (!reason) return c("declineReasonUnknown");
  const text = c(`declineReason_${reason}`);
  return text.startsWith("screens.offers.") ? c("declineReasonUnknown") : text;
}

function secondsSince(iso: string | null): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

/**
 * The offer's age in seconds, ticking. Deliberately NOT a countdown: how long
 * Uber keeps taking a decline from the dispatch panel is unknown — measuring it
 * is the point of this feature — so promising the operator a deadline would be a
 * lie. The age is the honest signal; `can_decline` is the actual limit.
 */
function useOfferAge(receivedAt: string | null): number | null {
  const [age, setAge] = useState(() => secondsSince(receivedAt));

  useEffect(() => {
    if (!receivedAt) return;
    const id = setInterval(() => setAge(secondsSince(receivedAt)), 1000);
    return () => clearInterval(id);
  }, [receivedAt]);

  return age;
}

/**
 * True once the clock passes the server's own decline deadline. `can_decline` is
 * only as fresh as the last Reverb refresh, so without this the button lingers
 * (and refuses on tap) after the real window has closed.
 */
function usePastDeadline(deadline: string | null): boolean {
  const at = deadline ? new Date(deadline).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(at)) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);

  return !Number.isNaN(at) && now >= at;
}
