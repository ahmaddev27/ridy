import { apiFetch } from "./client";

export type CompanySubscriptionRow = {
  id: number;
  plan: string | null;
  code: string | null;
  code_status: "pending" | "activated" | "expired" | null;
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
