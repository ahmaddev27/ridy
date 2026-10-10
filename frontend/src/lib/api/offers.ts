import { apiFetch, apiDownload } from "./client";

export type OfferStatus = "pending" | "accepted" | "started" | "completed" | "rejected" | "canceled";

/**
 * What a badge shows. One value more than the lifecycle `status`, because an
 * offer the fleet declined from the dispatch panel ends up `rejected` as well —
 * Uber's stream can only say "not taken" — and the two must not look alike.
 */
export type OfferBadgeStatus = OfferStatus | "dispatch_declined";

/**
 * The badge status for an offer — the backend `status` is the single source of
 * truth for the offer lifecycle. A fresh offer is held `pending` while the
 * driver is busy (kept for back-to-back) and is only moved to `rejected` once
 * the driver goes idle; the accept-window countdown is a client-side hint and
 * must NOT flip the label. So a missing status resolves to `pending` (a waiting
 * state), never a terminal "not taken" — only `rejected`/`canceled` read as
 * declined.
 *
 * A confirmed dispatch decline outranks all of that: the offer never reached the
 * driver, so labelling it "not taken" would read as the driver's own choice.
 */
export function offerBadgeStatus(offer: {
  status: OfferStatus | null;
  dispatch_rejected_at?: string | null;
}): OfferBadgeStatus {
  if (offer.dispatch_rejected_at) return "dispatch_declined";
  return offer.status ?? "pending";
}

export type DispatchOffer = {
  id: number;
  offer_uuid: string;
  driver_uuid: string;
  driver_id: number | null;
  driver_name: string | null;
  linked: boolean;
  status: OfferStatus | null;
  accepted: boolean;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  canceled_at: string | null;
  rider_first_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_formatted: string | null;
  fare_amount: number | null;
  accept_window_seconds: number | null;
  received_at: string | null;
  trip_duration_seconds: number | null;
  // Number of drop-offs once resolved from Uber's live map (>= 2 = multi-stop).
  stops_count: number | null;
  // Set once Uber CONFIRMED a decline sent from the dispatch panel — the only
  // thing that tells such an offer apart from one nobody took.
  dispatch_rejected_at: string | null;
  // The server's own verdict on whether it would accept a decline for this offer
  // right now (company flag, offer still pending, window open, attempts left).
  // Never recomputed here: a button the server would refuse must not be shown.
  can_decline: boolean;
};

/**
 * A consistent fare label. Uber sends the fare in mixed formats ("€7.35",
 * "7,35 €", "EUR7.35"), so prefer our parsed numeric amount formatted for the
 * locale; fall back to normalizing the raw string (EUR/USD → symbol).
 */
export function fareLabel(
  offer: { fare_amount: number | null; fare_formatted: string | null },
  locale: string,
): string {
  if (offer.fare_amount != null) {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(offer.fare_amount);
  }
  return (offer.fare_formatted ?? "—").replace(/EUR/gi, "€").replace(/USD/gi, "$");
}

export type TripInfo = {
  pickup: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number } | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  route_geometry: { coordinates: [number, number][] } | null;
  // Uber live-map stops (pickup first, then each drop-off), once resolved from the
  // driver's engaged position. stops_count >= 2 marks a multi-stop trip.
  // Each stop carries its address plus the road distance from the previous stop
  // (leg_m) and the running total to that stop (cumulative_m). Pickup has leg_m null.
  stops:
    | { lat: number; lng: number; type: string | null; address: string | null; leg_m: number | null; cumulative_m: number | null }[]
    | null;
  stops_count: number | null;
  geo_source: string | null;
  distance_km: number | null;
  fare_amount: number | null;
  price_per_km: number | null;
};

export type DispatchOfferDetail = DispatchOffer & {
  raw: Record<string, unknown> | null;
  trip: TripInfo | null;
};

export async function getOffer(id: number): Promise<DispatchOfferDetail> {
  const res = await apiFetch<{ data: DispatchOfferDetail }>(`/api/v1/dispatch/offers/${id}`);
  return res.data;
}

/** How the server took the request — "refused" carries a `reason` code. */
export type DispatchRejectStatus = "queued" | "duplicate" | "already_declined" | "refused";

export type DispatchRejectResult = {
  status: DispatchRejectStatus;
  reason?: string;
  command_id?: number;
};

/**
 * Ask the fleet's own Uber dispatch session to decline the offer, so declining
 * never touches the driver's acceptance rate.
 *
 * Queuing is all this confirms. Whether Uber took the decline shows up later on
 * the offer itself (`dispatch_rejected_at`), carried in by the feed's realtime
 * refresh. A refusal arrives as a 200 with `status: "refused"` — a verdict, not
 * a transport failure — so callers surface the reason instead of an error.
 */
export async function dispatchRejectOffer(id: number): Promise<DispatchRejectResult> {
  const res = await apiFetch<{ data: DispatchRejectResult }>(
    `/api/v1/dispatch/offers/${id}/dispatch-reject`,
    { method: "POST", withCsrf: true },
  );
  return res.data;
}

export type PageMeta = { current_page: number; last_page: number; total: number; per_page: number };

/** Paginated offers with page metadata — powers the offers data table. */
export async function listOffersPaged(params?: {
  search?: string;
  driverUuid?: string;
  driverUuids?: string[];
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}): Promise<{ items: DispatchOffer[]; meta: PageMeta }> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.driverUuid) q.set("driver_uuid", params.driverUuid);
  for (const uuid of params?.driverUuids ?? []) q.append("driver_uuids[]", uuid);
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.page) q.set("page", String(params.page));
  if (params?.perPage) q.set("per_page", String(params.perPage));
  const qs = q.toString();
  const res = await apiFetch<{ data: DispatchOffer[]; meta: PageMeta }>(
    `/api/v1/dispatch/offers${qs ? `?${qs}` : ""}`,
  );
  return { items: res.data, meta: res.meta };
}

export type OfferStats = {
  total: number;
  accepted: number;
  declined: number;
  completed: number;
  acceptance_rate: number;
  earnings: number;
  // Offers declined from the dispatch panel. They are excluded from `total`,
  // `accepted` and `declined` (they never reached a driver, so they are no
  // driver's offer), which is why the list can show more rows than `total`.
  dispatch_declined: number;
};

/** Aggregates for the current filter set (powers the offers stat cards). */
export async function getOfferStats(params?: {
  search?: string;
  driverUuids?: string[];
  from?: string;
  to?: string;
}): Promise<OfferStats> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  for (const uuid of params?.driverUuids ?? []) q.append("driver_uuids[]", uuid);
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  const res = await apiFetch<{ data: OfferStats }>(`/api/v1/dispatch/offers/stats${qs ? `?${qs}` : ""}`);
  return res.data;
}

/** Download the filtered offers as a CSV (Excel) file, carrying the session cookie. */
export async function exportOffers(params?: {
  search?: string;
  driverUuids?: string[];
  from?: string;
  to?: string;
}): Promise<Blob> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  for (const uuid of params?.driverUuids ?? []) q.append("driver_uuids[]", uuid);
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  return apiDownload(`/api/v1/dispatch/offers/export${qs ? `?${qs}` : ""}`);
}

export async function listOffers(params?: {
  search?: string;
  driverUuid?: string;
}): Promise<DispatchOffer[]> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.driverUuid) q.set("driver_uuid", params.driverUuid);
  const qs = q.toString();
  const res = await apiFetch<{ data: DispatchOffer[] }>(
    `/api/v1/dispatch/offers${qs ? `?${qs}` : ""}`,
  );
  return res.data;
}
