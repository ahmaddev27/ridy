import { apiFetch } from "./client";

export type UnlinkedDriver = {
  uber_driver_uuid: string;
  name: string | null;
  offers: number;
};

export async function listUnlinkedDrivers(): Promise<UnlinkedDriver[]> {
  const res = await apiFetch<{ data: UnlinkedDriver[] }>("/api/v1/dispatch/unlinked-drivers");
  return res.data;
}

/** Manually attach an unlinked Uber UUID to an existing driver. */
export async function linkDriver(
  driverId: number,
  uberDriverUuid: string,
  uberEmail?: string,
): Promise<{ driver_id: number; backfilled_offers: number }> {
  const res = await apiFetch<{ data: { driver_id: number; backfilled_offers: number } }>(
    `/api/v1/drivers/${driverId}/link-uber`,
    { method: "POST", body: { uber_driver_uuid: uberDriverUuid, uber_email: uberEmail }, withCsrf: true },
  );
  return res.data;
}
