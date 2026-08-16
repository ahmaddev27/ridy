import { apiFetch, apiDownload } from "./client";

export type OfferStatus = "pending" | "accepted" | "started" | "completed" | "rejected" | "canceled";

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

export async function deleteOffer(id: number): Promise<void> {
  await apiFetch(`/api/v1/dispatch/offers/${id}`, { method: "DELETE", withCsrf: true });
}

export async function bulkDeleteOffers(ids: number[]): Promise<number> {
  const res = await apiFetch<{ data: { deleted: number } }>(
    "/api/v1/dispatch/offers/bulk-delete",
    { method: "POST", body: { ids }, withCsrf: true },
  );
  return res.data.deleted;
}
