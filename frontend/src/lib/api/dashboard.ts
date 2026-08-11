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
  online_drivers: number;
  vehicles: number;
  offers_today: number;
  unlinked_offers: number;
  offers_daily: { date: string; count: number }[];
  fleet_session: FleetSession;
  subscription: {
    state: "disabled" | "banned" | "expired" | "inactive" | null;
    activated_at: string | null;
    ends_at: string | null;
    days_left: number | null;
  } | null;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await apiFetch<{ data: DashboardSummary }>("/api/v1/dashboard/summary");
  return res.data;
}
