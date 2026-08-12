import { apiFetch } from "./client";

export type ResellerPlan = { id: number; name: string; price: number; duration_days: number };
export type ResellerCompany = { id: number; name: string; phone: string | null };
export type GeneratedCode = {
  code: string;
  company: string;
  plan: string;
  days: number;
  price: number;
  expires_at: string;
};

export async function getResellerPlans(): Promise<ResellerPlan[]> {
  const res = await apiFetch<{ data: ResellerPlan[] }>("/api/v1/reseller/plans");
  return res.data;
}

export async function searchResellerCompanies(q: string): Promise<ResellerCompany[]> {
  const res = await apiFetch<{ data: ResellerCompany[] }>(`/api/v1/reseller/companies/search?q=${encodeURIComponent(q)}`);
  return res.data;
}

export async function generateResellerCode(tenantId: number, planId: number): Promise<GeneratedCode> {
  const res = await apiFetch<{ data: GeneratedCode }>("/api/v1/reseller/activation", {
    method: "POST",
    body: { tenant_id: tenantId, plan_id: planId },
    withCsrf: true,
  });
  return res.data;
}

export type CodeStatus = "pending" | "activated" | "expired";

/** One row in a codes ledger (reseller's own or the admin-wide view). */
export type CodeRow = {
  id: number;
  code: string;
  plan: string | null;
  company: string | null;
  collector: string | null;
  amount: number | null;
  paid: boolean;
  status: CodeStatus;
  created_at: string | null;
  activated_at: string | null;
  expires_at: string | null;
};

export type CodesPage = {
  data: CodeRow[];
  meta: { current_page: number; last_page: number; total: number };
};

/** Filters shared by the reseller and admin code ledgers. */
export type CodeFilters = {
  status?: CodeStatus | "";
  from?: string;
  to?: string;
  page?: number;
  tenant_id?: number;
  collector_id?: number;
};

function codesQuery(f: CodeFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.page) p.set("page", String(f.page));
  if (f.tenant_id) p.set("tenant_id", String(f.tenant_id));
  if (f.collector_id) p.set("collector_id", String(f.collector_id));
  const q = p.toString();
  return q ? `?${q}` : "";
}

export const codesQueryString = codesQuery;

export async function getResellerCodes(filters: CodeFilters = {}): Promise<CodesPage> {
  return apiFetch<CodesPage>(`/api/v1/reseller/codes${codesQuery(filters)}`);
}
