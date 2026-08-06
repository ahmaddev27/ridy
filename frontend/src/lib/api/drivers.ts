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
};

export async function listDrivers(): Promise<Driver[]> {
  const res = await apiFetch<{ data: Driver[] }>("/api/v1/drivers");
  return res.data;
}
