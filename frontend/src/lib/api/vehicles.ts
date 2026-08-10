import { apiFetch } from "./client";

export type Vehicle = {
  id: number;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string | null;
  vin: string | null;
  color: string | null;
  color_hex: string | null;
  image_url: string | null;
  compliance_status: string | null;
  assigned_driver: string | null;
  synced_at: string | null;
};

export async function listVehicles(): Promise<Vehicle[]> {
  const res = await apiFetch<{ data: Vehicle[] }>("/api/v1/vehicles");
  return res.data;
}
