import { apiFetch } from "./client";

export type Driver = {
  id: number;
  name: string;
  pseudonym: string | null;
  phone: string | null;
  uber_driver_uuid: string | null;
  uber_email: string | null;
  uber_link_method: string | null;
  uber_linked: boolean;
  picture_url: string | null;
  rating: number | null;
  total_trips: number | null;
  status: string | null;
  active: boolean;
  online: boolean;
  online_status: string | null;
  location_updated_at: string | null;
};

export async function listDrivers(): Promise<Driver[]> {
  const res = await apiFetch<{ data: Driver[] }>("/api/v1/drivers");
  return res.data;
}

export async function getDriver(id: number): Promise<Driver> {
  const res = await apiFetch<{ data: Driver }>(`/api/v1/drivers/${id}`);
  return res.data;
}

export type DriverStats = {
  offers: number;
  accepted: number;
  declined: number;
  acceptance_rate: number;
  earnings: number;
  trips: number;
  km: number;
};

/** Work stats computed from our own captured offers/acceptance data. */
export async function getDriverStats(id: number, from?: string, to?: string): Promise<DriverStats> {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const qs = p.toString();
  const res = await apiFetch<{ data: DriverStats }>(`/api/v1/drivers/${id}/stats${qs ? `?${qs}` : ""}`);
  return res.data;
}

/** Trigger an on-demand roster pull from Uber (best-effort). */
export async function syncDrivers(): Promise<{ synced: number; created?: number; reason?: string }> {
  const res = await apiFetch<{ data: { synced: number; created?: number; reason?: string } }>(
    "/api/v1/drivers/sync",
    { method: "POST", withCsrf: true },
  );
  return res.data;
}

// ── Live map ─────────────────────────────────────────────────────────────────
export type LiveWaypoint = { lat: number; lng: number; type: string | null };

export type LiveDriver = {
  id: number;
  name: string;
  status: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  waypoints: LiveWaypoint[] | null;
  location_updated_at: string | null;
};

export async function getLiveDrivers(): Promise<LiveDriver[]> {
  const res = await apiFetch<{ data: LiveDriver[] }>("/api/v1/drivers/live");
  return res.data;
}
