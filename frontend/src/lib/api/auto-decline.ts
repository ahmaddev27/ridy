import { apiFetch } from "./client";
import type { DispatchOffer, PageMeta } from "./offers";

export type AutoDeclineReason = "min_fare" | "reject_cities" | "max_pickup_distance" | "max_trip_distance";

export const AUTO_DECLINE_REASONS: AutoDeclineReason[] = [
  "min_fare",
  "reject_cities",
  "max_pickup_distance",
  "max_trip_distance",
];

export type AutoDeclineRules = {
  min_fare: { enabled: boolean; value_e2: number };
  reject_cities: { enabled: boolean; cities: string[] };
  max_pickup_distance: { enabled: boolean; km: number };
  max_trip_distance: { enabled: boolean; km: number };
};

export type AutoDeclineDriver = { id: number; name: string; rules: AutoDeclineRules };

export type AutoDeclineOverview = { feature_enabled: boolean; drivers: AutoDeclineDriver[] };

/** A row of the admin-managed drivers list (all drivers, not only those with the feature on). */
export type AutoDeclineManagedDriver = AutoDeclineDriver & {
  /** Admin switch: false locks the feature, the driver cannot enable it. */
  admin_enabled: boolean;
  /** The driver's own opt-in. */
  enabled: boolean;
  /** admin_enabled && enabled — rules are really being applied. */
  active: boolean;
};

export type AutoDeclineDrivers = {
  feature_enabled: boolean;
  available_cities: string[];
  drivers: AutoDeclineManagedDriver[];
};

/** An offer row plus the rule that declined it (the resource already sends this). */
export type EarlyDeclinedOffer = DispatchOffer & { auto_decline_reason: AutoDeclineReason | null };

export async function getAutoDeclineOverview(): Promise<AutoDeclineOverview> {
  const res = await apiFetch<{ data: AutoDeclineOverview }>("/api/v1/auto-decline");
  return res.data;
}

export async function listEarlyDeclined(params: {
  driverId?: number;
  reason?: AutoDeclineReason;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}): Promise<{ items: EarlyDeclinedOffer[]; meta: PageMeta }> {
  const q = new URLSearchParams();
  if (params.driverId) q.set("driver_id", String(params.driverId));
  if (params.reason) q.set("reason", params.reason);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.page) q.set("page", String(params.page));
  if (params.perPage) q.set("per_page", String(params.perPage));
  const qs = q.toString();
  const res = await apiFetch<{ data: EarlyDeclinedOffer[]; meta: PageMeta }>(
    `/api/v1/auto-decline/history${qs ? `?${qs}` : ""}`,
  );
  return { items: res.data, meta: res.meta };
}

export async function getAutoDeclineDrivers(): Promise<AutoDeclineDrivers> {
  const res = await apiFetch<{ data: AutoDeclineDrivers }>("/api/v1/auto-decline/drivers");
  return res.data;
}

export async function updateDriverAutoDecline(
  id: number,
  body: { admin_enabled?: boolean; rules?: AutoDeclineRules },
): Promise<AutoDeclineManagedDriver> {
  const res = await apiFetch<{ data: AutoDeclineManagedDriver }>(`/api/v1/auto-decline/drivers/${id}`, {
    method: "PUT",
    body,
    withCsrf: true,
  });
  return res.data;
}
