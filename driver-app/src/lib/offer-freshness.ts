import type { Offer } from "./api";

/**
 * Whether a pending offer is still inside its Uber accept window — pure logic
 * (no native imports) so it is unit-testable and shared by the in-app alert and
 * Home's "New offer" card. An ENGAGED driver's pending offer is held by the
 * backend long after its window closed; it must never look "new".
 */

/** Accept window assumed when the offer carries none (seconds). */
export const DEFAULT_WINDOW_S = 15;
/** Slack for clock skew between the phone and the server (seconds). */
export const CLOCK_SKEW_S = 10;

type FreshnessFields = Pick<Offer, "received_at" | "accept_window_seconds">;

/** Epoch ms at which the offer stops being fresh (NaN when it has no receive time). */
export function freshUntil(offer: FreshnessFields): number {
  const received = offer.received_at ? Date.parse(offer.received_at) : NaN;
  const windowS = (offer.accept_window_seconds ?? DEFAULT_WINDOW_S) + CLOCK_SKEW_S;
  return received + windowS * 1000;
}

/** True while the offer is still inside its accept window (plus clock slack). */
export function isFreshOffer(offer: FreshnessFields, now = Date.now()): boolean {
  return now <= freshUntil(offer);
}
