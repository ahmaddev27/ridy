import { apiFetch } from "./client";

export type FleetSession = {
  uber_org_uuid: string;
  status: "active" | "expired" | "needs_relink";
  expires_at: string | null;
  last_event_at: string | null;
} | null;

export type Cookie = { name: string; value: string };

export async function getFleetSession(): Promise<FleetSession> {
  const res = await apiFetch<{ data: FleetSession }>("/api/v1/fleet-session");
  return res.data;
}

export async function captureFleetSession(input: {
  uber_org_uuid: string;
  cookies: Cookie[];
  expires_at?: string;
}): Promise<FleetSession> {
  const res = await apiFetch<{ data: FleetSession }>("/api/v1/fleet-session", {
    method: "POST",
    body: input,
    withCsrf: true,
  });
  return res.data;
}
