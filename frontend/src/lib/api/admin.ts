import { apiFetch } from "./client";

export type Company = {
  id: number;
  name: string;
  country: string | null;
  status: string;
  uber_org_uuid: string | null;
  has_proxy: boolean;
  proxy_url_masked: string | null;
  proxy_url: string | null; // present only in detail
  driver_count: number;
  offer_count: number;
  session_status: string | null;
  session_last_event_at: string | null;
  session_expires_at: string | null;
  users?: CompanyUser[] | null;
};

export type CompanyUser = {
  id: number;
  name: string;
  email: string;
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
  proxy_url: string; // empty string clears it (→ global proxy)
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
  has_global_proxy: boolean;
  global_proxy_masked: string | null;
};

export type UpdateSettingsInput = Partial<{
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string; // only when changing
  smtp_encryption: string;
  mail_from_address: string;
  mail_from_name: string;
  global_proxy_url: string; // only when changing (empty clears)
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

export async function disableCompany(id: number): Promise<void> {
  await apiFetch(`${base}/${id}`, { method: "DELETE", withCsrf: true });
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
