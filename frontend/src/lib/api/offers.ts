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

export async function listOffers(): Promise<DispatchOffer[]> {
  const res = await apiFetch<{ data: DispatchOffer[] }>("/api/v1/dispatch/offers");
  return res.data;
}
