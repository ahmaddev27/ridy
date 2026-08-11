import { apiFetch } from "./client";

export type Company = {
  id: number;
  name: string;
  country: string | null;
  status: string;
  uber_org_uuid: string | null;
  has_proxy: boolean;
  proxy_id: number | null;
  proxy_label: string | null; // present only in detail
  driver_count: number;
  offer_count: number;
  email_verified: boolean;
  state: "disabled" | "banned" | "expired" | "inactive" | null;
  activated_at: string | null;
  subscription_ends_at: string | null;
  days_left: number | null;
  banned: boolean;
  session_status: string | null;
  session_last_event_at: string | null;
  session_expires_at: string | null;
  users?: CompanyUser[] | null;
};

export type BannedCompany = {
  id: number;
  name: string;
  banned_at: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
};

export type CompanyUser = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  roles: string[];
};

export type CompanySession = {
  id: number;
  uber_org_uuid: string;
  status: string;
  expires_at: string | null;
  last_event_at: string | null;
} | null;

export type CreateCompanyInput = {
  name: string;
  country?: string;
  status?: string;
  uber_org_uuid?: string;
  proxy_url?: string;
  manager_name?: string;
  manager_email?: string;
  manager_password?: string;
};

export type UpdateCompanyInput = Partial<{
  name: string;
  country: string;
  status: string;
  uber_org_uuid: string;
  proxy_id: number | null; // pool proxy; null = auto/none
  subscription_ends_at: string | null;
}>;

export type AdminOverview = {
  stats: {
    companies: number;
    active_companies: number;
    drivers: number;
    offers: number;
    sessions_active: number;
    sessions_need_attention: number;
  };
  alerts: { company_id: number; company: string; type: string }[];
  session_breakdown: { active: number; expired: number; needs_relink: number; no_session: number };
  offers_daily: { date: string; count: number }[];
  top_companies: { company_id: number; company: string; offers: number; drivers: number }[];
};

export type PlatformSettings = {
  smtp_host: string | null;
  smtp_port: string | null;
  smtp_username: string | null;
  smtp_encryption: string | null;
  mail_from_address: string | null;
  mail_from_name: string | null;
  has_smtp_password: boolean;
  support_email: string | null;
  support_whatsapp: string | null;
};

export type UpdateSettingsInput = Partial<{
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string; // only when changing
  smtp_encryption: string;
  mail_from_address: string;
  mail_from_name: string;
  support_email: string;
  support_whatsapp: string;
}>;

export async function getOverview(): Promise<AdminOverview> {
  const res = await apiFetch<{ data: AdminOverview }>("/api/v1/admin/overview");
  return res.data;
}

export async function getSettings(): Promise<PlatformSettings> {
  const res = await apiFetch<{ data: PlatformSettings }>("/api/v1/admin/settings");
  return res.data;
}

export async function updateSettings(input: UpdateSettingsInput): Promise<PlatformSettings> {
  const res = await apiFetch<{ data: PlatformSettings }>("/api/v1/admin/settings", {
    method: "PUT",
    body: input,
    withCsrf: true,
  });
  return res.data;
}

const base = "/api/v1/admin/companies";

export async function listCompanies(): Promise<Company[]> {
  const res = await apiFetch<{ data: Company[] }>(base);
  return res.data;
}

export async function getCompany(id: number): Promise<Company> {
  const res = await apiFetch<{ data: Company }>(`${base}/${id}`);
  return res.data;
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const res = await apiFetch<{ data: Company }>(base, { method: "POST", body: input, withCsrf: true });
  return res.data;
}

export async function updateCompany(id: number, input: UpdateCompanyInput): Promise<Company> {
  const res = await apiFetch<{ data: Company }>(`${base}/${id}`, { method: "PUT", body: input, withCsrf: true });
  return res.data;
}

/** PERMANENTLY deletes a company and all its data. Not reversible — use
 *  setCompanyActive(id, false) to merely disable. */
export async function deleteCompany(id: number): Promise<void> {
  await apiFetch(`${base}/${id}`, { method: "DELETE", withCsrf: true });
}

/** Generate a 2-minute activation code for the company owner to enter. */
export async function generateActivationCode(
  id: number,
  days: number,
): Promise<{ code: string; days: number; expires_at: string }> {
  const res = await apiFetch<{ data: { code: string; days: number; expires_at: string } }>(
    `${base}/${id}/activation`,
    { method: "POST", body: { days }, withCsrf: true },
  );
  return res.data;
}

export async function listBannedCompanies(): Promise<BannedCompany[]> {
  const res = await apiFetch<{ data: BannedCompany[] }>("/api/v1/admin/banned-companies");
  return res.data;
}

export async function reactivateCompany(id: number): Promise<void> {
  await apiFetch(`${base}/${id}/reactivate`, { method: "POST", withCsrf: true });
}

// ── Per-company drill-down (admin detail tabs) ───────────────────────────────
export type CompanyDriverRow = {
  id: number; name: string; online: boolean; online_status: string | null;
  uber_linked: boolean; rating: number | null; total_trips: number | null;
};
export type CompanyOfferRow = {
  id: number; received_at: string | null; driver_name: string | null;
  pickup_address: string | null; dropoff_address: string | null;
  fare_formatted: string | null; accepted: boolean;
};
export type CompanyVehicleRow = {
  id: number; make: string | null; model: string | null; year: number | null;
  license_plate: string | null; color: string | null; compliance_status: string | null;
};

export async function getCompanyDrivers(id: number): Promise<CompanyDriverRow[]> {
  const res = await apiFetch<{ data: CompanyDriverRow[] }>(`${base}/${id}/drivers`);
  return res.data;
}
export async function getCompanyOffers(id: number): Promise<CompanyOfferRow[]> {
  const res = await apiFetch<{ data: CompanyOfferRow[] }>(`${base}/${id}/offers`);
  return res.data;
}
export async function getCompanyVehicles(id: number): Promise<CompanyVehicleRow[]> {
  const res = await apiFetch<{ data: CompanyVehicleRow[] }>(`${base}/${id}/vehicles`);
  return res.data;
}

// ── Proxy pool ──────────────────────────────────────────────────────────────
export type Proxy = {
  id: number;
  label: string;
  url_masked: string | null;
  capacity: number;
  used: number;
  free: number;
  near_full: boolean;
  notes: string | null;
};

export type ProxyInput = { label: string; url?: string; capacity: number; notes?: string };

const proxyBase = "/api/v1/admin/proxies";

export async function listProxies(): Promise<Proxy[]> {
  const res = await apiFetch<{ data: Proxy[] }>(proxyBase);
  return res.data;
}

export async function createProxy(input: ProxyInput): Promise<Proxy> {
  const res = await apiFetch<{ data: Proxy }>(proxyBase, { method: "POST", body: input, withCsrf: true });
  return res.data;
}

export async function updateProxy(id: number, input: ProxyInput): Promise<Proxy> {
  const res = await apiFetch<{ data: Proxy }>(`${proxyBase}/${id}`, { method: "PUT", body: input, withCsrf: true });
  return res.data;
}

export async function deleteProxy(id: number): Promise<void> {
  await apiFetch(`${proxyBase}/${id}`, { method: "DELETE", withCsrf: true });
}

/** Toggle a company between active and disabled (reversible, keeps all data). */
export async function setCompanyActive(id: number, active: boolean): Promise<Company> {
  return updateCompany(id, { status: active ? "active" : "disabled" });
}

export async function listCompanyUsers(id: number): Promise<CompanyUser[]> {
  const res = await apiFetch<{ data: CompanyUser[] }>(`${base}/${id}/users`);
  return res.data;
}

export async function createCompanyUser(
  id: number,
  input: { name: string; email: string; password: string },
): Promise<CompanyUser> {
  const res = await apiFetch<{ data: CompanyUser }>(`${base}/${id}/users`, {
    method: "POST",
    body: input,
    withCsrf: true,
  });
  return res.data;
}

export async function resetCompanyUserPassword(
  id: number,
  userId: number,
  password: string,
): Promise<void> {
  await apiFetch(`${base}/${id}/users/${userId}/reset-password`, {
    method: "POST",
    body: { password },
    withCsrf: true,
  });
}

export async function getCompanySession(id: number): Promise<CompanySession> {
  const res = await apiFetch<{ data: CompanySession }>(`${base}/${id}/session`);
  return res.data;
}

export async function forceRelink(id: number): Promise<void> {
  await apiFetch(`${base}/${id}/session/relink`, { method: "POST", withCsrf: true });
}

export async function deleteCompanySession(id: number): Promise<void> {
  await apiFetch(`${base}/${id}/session`, { method: "DELETE", withCsrf: true });
}
