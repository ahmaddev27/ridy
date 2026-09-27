import type { Status } from "@/components/ui/badge";
import type { OfferStatus } from "@/lib/api/offers";

/** Offer lifecycle status → badge tone (shared by the offers list, detail modal and driver profile). */
export const OFFER_TONE: Record<OfferStatus, Status> = {
  pending: "expiring",
  accepted: "info",
  started: "private",
  completed: "connected",
  rejected: "neutral",
  canceled: "personal",
};
