"use client";

import { Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import { OFFER_TONE } from "@/lib/offer-status";
import { offerBadgeStatus, type OfferStatus } from "@/lib/api/offers";

/**
 * The offer's status badge — one component for the offers feed, the detail modal
 * and the driver profile, which all used to repeat the same two lines.
 *
 * It exists mainly because a dispatch decline and an offer nobody took share the
 * same backend `status` ("rejected"): without the `dispatch_rejected_at` branch
 * the operator's own deliberate decline renders exactly like an expired offer.
 * The icon carries that distinction for anyone who can't tell the tones apart.
 */
export function OfferStatusBadge({
  offer,
}: {
  offer: { status: OfferStatus | null; dispatch_rejected_at?: string | null };
}) {
  const { t } = useI18n();
  const status = offerBadgeStatus(offer);
  const declined = status === "dispatch_declined";

  return (
    <Badge status={OFFER_TONE[status]} dot={!declined}>
      {declined && <Ban className="h-3 w-3 shrink-0" />}
      {t(`screens.offers.st_${status}`)}
    </Badge>
  );
}
