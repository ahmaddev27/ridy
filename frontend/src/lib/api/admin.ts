import { apiFetch, apiDownload } from "./client";

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
  mail_provider: "smtp" | "resend";
  has_resend_key: boolean;
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
  mail_provider: "smtp" | "resend";
  resend_api_key: string; // only when changing
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

/** Send a test email to `to` (or the admin's own address) via the current provider. */
export async function sendTestEmail(to?: string): Promise<{ sent: boolean; to?: string }> {
  const res = await apiFetch<{ data: { sent: boolean; to?: string } }>("/api/v1/admin/settings/test-email", {
    method: "POST",
    body: to ? { to } : {},
    withCsrf: true,
  });
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
  amount?: number,
  paid?: boolean,
): Promise<{ code: string; days: number; expires_at: string }> {
  const res = await apiFetch<{ data: { code: string; days: number; expires_at: string } }>(
    `${base}/${id}/activation`,
    { method: "POST", body: { days, amount, paid }, withCsrf: true },
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
export async function getCompanyOffers(
  id: number,
  page = 1,
): Promise<{ items: CompanyOfferRow[]; lastPage: number; total: number }> {
  const res = await apiFetch<{ data: CompanyOfferRow[]; meta: { last_page: number; total: number } }>(
    `${base}/${id}/offers?page=${page}`,
  );
  return { items: res.data, lastPage: res.meta.last_page, total: res.meta.total };
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

// ── Cash collectors + payment ledger ─────────────────────────────────────────
export type Collector = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  payments_count: number;
  total_collected: number;
  last_paid_on: string | null;
};

export type CollectorInput = { name: string; phone?: string; address?: string };

export type CollectorPayment = {
  id: number;
  collector_id: number;
  collector_name: string | null;
  tenant_id: number;
  company_name: string | null;
  amount: number;
  paid_on: string;
  note: string | null;
};

export type PaymentFilters = { collector_id?: number; tenant_id?: number; from?: string; to?: string; page?: number };

const collectorBase = "/api/v1/admin/collectors";
const paymentBase = "/api/v1/admin/collector-payments";

export async function listCollectors(): Promise<Collector[]> {
  const res = await apiFetch<{ data: Collector[] }>(collectorBase);
  return res.data;
}

export async function createCollector(input: CollectorInput): Promise<Collector> {
  const res = await apiFetch<{ data: Collector }>(collectorBase, { method: "POST", body: input, withCsrf: true });
  return res.data;
}

export async function updateCollector(id: number, input: CollectorInput): Promise<Collector> {
  const res = await apiFetch<{ data: Collector }>(`${collectorBase}/${id}`, { method: "PUT", body: input, withCsrf: true });
  return res.data;
}

export async function deleteCollector(id: number): Promise<void> {
  await apiFetch(`${collectorBase}/${id}`, { method: "DELETE", withCsrf: true });
}

function paymentQuery(f: PaymentFilters): string {
  const p = new URLSearchParams();
  if (f.collector_id) p.set("collector_id", String(f.collector_id));
  if (f.tenant_id) p.set("tenant_id", String(f.tenant_id));
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.page) p.set("page", String(f.page));
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export async function listCollectorPayments(
  f: PaymentFilters = {},
): Promise<{ data: CollectorPayment[]; meta: { current_page: number; last_page: number; total: number; sum: number } }> {
  return apiFetch(`${paymentBase}${paymentQuery(f)}`);
}

export async function createCollectorPayment(input: {
  collector_id: number;
  tenant_id: number;
  amount: number;
  paid_on: string;
  note?: string;
}): Promise<CollectorPayment> {
  const res = await apiFetch<{ data: CollectorPayment }>(paymentBase, { method: "POST", body: input, withCsrf: true });
  return res.data;
}

export async function deleteCollectorPayment(id: number): Promise<void> {
  await apiFetch(`${paymentBase}/${id}`, { method: "DELETE", withCsrf: true });
}

export async function exportCollectorPayments(f: PaymentFilters = {}): Promise<Blob> {
  return apiDownload(`${paymentBase}/export${paymentQuery(f)}`);
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

// ── Billing reports ──────────────────────────────────────────────────────────
export type BillingSummary = {
  revenue_by_month: { month: string; total: number }[];
  expiring: { id: number; name: string; ends_at: string | null; days_left: number | null }[];
  totals: { total_revenue: number; outstanding: number; active_subscriptions: number; expiring_soon: number };
};

export type SubscriptionInvoice = {
  id: number;
  tenant_id: number;
  company_name: string | null;
  days: number;
  amount: number | null;
  paid: boolean;
  paid_at: string | null;
  collector_payment_id: number | null;
  starts_at: string;
  ends_at: string;
};

export async function getBillingSummary(): Promise<BillingSummary> {
  const res = await apiFetch<{ data: BillingSummary }>("/api/v1/admin/reports/billing-summary");
  return res.data;
}

export async function listSubscriptionInvoices(
  tenantId?: number,
): Promise<{ data: SubscriptionInvoice[]; meta: { current_page: number; last_page: number; total: number } }> {
  const qs = tenantId ? `?tenant_id=${tenantId}` : "";
  return apiFetch(`/api/v1/admin/subscription-invoices${qs}`);
}

export async function exportSubscriptionInvoices(tenantId?: number): Promise<Blob> {
  const qs = tenantId ? `?tenant_id=${tenantId}` : "";
  return apiDownload(`/api/v1/admin/subscription-invoices/export${qs}`);
}

export async function settleInvoice(invoiceId: number, collectorPaymentId: number): Promise<SubscriptionInvoice> {
  const res = await apiFetch<{ data: SubscriptionInvoice }>(
    `/api/v1/admin/subscription-invoices/${invoiceId}/settle`,
    { method: "POST", body: { collector_payment_id: collectorPaymentId }, withCsrf: true },
  );
  return res.data;
}

// ── Subscription plans ───────────────────────────────────────────────────────
export type Plan = { id: number; name: string; price: number; duration_days: number; active: boolean };
export type PlanInput = { name: string; price: number; duration_days: number; active?: boolean };

const planBase = "/api/v1/admin/plans";

export async function listPlans(): Promise<Plan[]> {
  const res = await apiFetch<{ data: Plan[] }>(planBase);
  return res.data;
}
export async function createPlan(input: PlanInput): Promise<Plan> {
  const res = await apiFetch<{ data: Plan }>(planBase, { method: "POST", body: input, withCsrf: true });
  return res.data;
}
export async function updatePlan(id: number, input: PlanInput): Promise<Plan> {
  const res = await apiFetch<{ data: Plan }>(`${planBase}/${id}`, { method: "PUT", body: input, withCsrf: true });
  return res.data;
}
export async function deletePlan(id: number): Promise<void> {
  await apiFetch(`${planBase}/${id}`, { method: "DELETE", withCsrf: true });
}
