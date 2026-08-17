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

/** Disconnect: delete the tenant's Uber fleet session(s). */
/** Clear the tenant's autolink block before an explicit dashboard reconnect. */
export async function prepareReconnect(): Promise<void> {
  await apiFetch("/api/v1/fleet-session/reconnect", { method: "POST" });
}

export async function deleteFleetSession(): Promise<{ deleted: number }> {
  const res = await apiFetch<{ data: { deleted: number } }>("/api/v1/fleet-session", {
    method: "DELETE",
    withCsrf: true,
  });
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
