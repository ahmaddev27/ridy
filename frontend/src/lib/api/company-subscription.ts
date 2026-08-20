import { apiFetch } from "./client";

export type CompanySubscriptionRow = {
  id: number;
  plan: string | null;
  code: string | null;
  code_status: "pending" | "activated" | "expired" | null;
  period_status: "active" | "scheduled" | "ended";
  collector: string | null;
  amount: number | null;
  paid: boolean;
  days: number;
  starts_at: string;
  ends_at: string;
};

/** The authenticated company's own subscription history. */
export async function getCompanySubscriptions(): Promise<CompanySubscriptionRow[]> {
  const res = await apiFetch<{ data: CompanySubscriptionRow[] }>("/api/v1/subscription/history");
  return res.data;
}

/** Redeem a subscription code from inside the dashboard (stacks after current). */
export async function redeemSubscriptionCode(code: string): Promise<{ activated: boolean; days: number; ends_at: string }> {
  const res = await apiFetch<{ data: { activated: boolean; days: number; ends_at: string } }>("/api/v1/subscription/redeem", {
    method: "POST",
    body: { code },
    withCsrf: true,
  });
  return res.data;
}
