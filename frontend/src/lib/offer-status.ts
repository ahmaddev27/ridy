import type { Status } from "@/components/ui/badge";
import type { OfferBadgeStatus } from "@/lib/api/offers";

/** Offer badge value → badge tone (shared by the offers list, detail modal and driver profile). */
export const OFFER_TONE: Record<OfferBadgeStatus, Status> = {
  pending: "expiring",
  accepted: "info",
  started: "private",
  completed: "connected",
  rejected: "neutral",
  canceled: "personal",
  // Its own tone on purpose: a dispatch decline is the fleet's deliberate act,
  // so it must not share the muted "nobody took it" grey of `rejected` — nor the
  // red of `canceled`, which reads as something going wrong.
  dispatch_declined: "private",
};
