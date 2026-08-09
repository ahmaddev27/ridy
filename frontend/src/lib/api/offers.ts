import { apiFetch } from "./client";

export type DispatchOffer = {
  id: number;
  offer_uuid: string;
  driver_uuid: string;
  driver_id: number | null;
  driver_name: string | null;
  linked: boolean;
  rider_first_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_formatted: string | null;
  accept_window_seconds: number | null;
  received_at: string | null;
};

export type DispatchOfferDetail = DispatchOffer & {
  raw: Record<string, unknown> | null;
};

export async function getOffer(id: number): Promise<DispatchOfferDetail> {
  const res = await apiFetch<{ data: DispatchOfferDetail }>(`/api/v1/dispatch/offers/${id}`);
  return res.data;
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
