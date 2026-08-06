import { apiFetch } from "./client";

export type FleetSession = {
  uber_org_uuid: string;
  status: "active" | "expired" | "needs_relink";
  last_event_at: string | null;
  expires_at: string | null;
} | null;

export type DashboardSummary = {
  drivers: number;
  linked_drivers: number;
  offers_today: number;
  unlinked_offers: number;
  fleet_session: FleetSession;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await apiFetch<{ data: DashboardSummary }>("/api/v1/dashboard/summary");
  return res.data;
}
