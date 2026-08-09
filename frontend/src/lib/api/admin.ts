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
