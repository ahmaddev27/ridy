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
