import { apiFetch } from "./client";

export type BankPaymentMethod = {
  holder: string | null;
  bank: string | null;
  iban: string | null;
  bic: string | null;
  note: string | null;
};

export type CashPaymentMethod = {
  whatsapp: string | null;
  note: string | null;
};

export type PaymentMethods = {
  bank: BankPaymentMethod | null;
  cash: CashPaymentMethod | null;
};

/**
 * Public subscription payment methods (bank transfer / cash), readable without
 * auth so both the in-app subscription page and the pre-login suspended screen
 * can show a company how to pay. Only admin-enabled methods come back non-null.
 */
export async function getPaymentMethods(): Promise<PaymentMethods> {
  const res = await apiFetch<{ data: PaymentMethods }>("/api/v1/payment-methods");
  return res.data;
}

/**
 * The recorded ways a subscription can be paid, kept in sync with the backend's
 * SubscriptionCode::PAYMENT_METHODS. Adding a method here + its settings/i18n
 * keys makes it selectable and displayable — no schema change needed.
 */
export const PAYMENT_METHOD_KEYS = ["bank", "cash"] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

/** Localized label for a stored payment method, or "—" when none is recorded. */
export function paymentMethodLabel(method: string | null | undefined, t: (k: string) => string): string {
  if (method === "bank") return t("screens.codes.method_bank");
  if (method === "cash") return t("screens.codes.method_cash");
  return "—";
}

/** The authenticated company's stable payment reference + whether a claim is pending. */
export async function getPaymentReference(): Promise<{ reference: string | null; claim_pending: boolean }> {
  const res = await apiFetch<{ data: { reference: string | null; claim_pending: boolean } }>(
    "/api/v1/subscription/payment-reference",
  );
  return res.data;
}

/** "I've paid" from inside the dashboard (idempotent — one pending claim/company). */
export async function submitPaymentClaim(): Promise<{ pending: boolean; created: boolean; reference: string }> {
  const res = await apiFetch<{ data: { pending: boolean; created: boolean; reference: string } }>(
    "/api/v1/subscription/payment-claim",
    { method: "POST", withCsrf: true },
  );
  return res.data;
}

/** "I've paid" from the pre-login suspended screen (credential-checked). */
export async function submitPaymentClaimWithCredentials(
  email: string,
  password: string,
): Promise<{ pending: boolean; created: boolean; reference: string }> {
  const res = await apiFetch<{ data: { pending: boolean; created: boolean; reference: string } }>(
    "/api/v1/company/payment-claim",
    { method: "POST", body: { email, password }, withCsrf: true },
  );
  return res.data;
}
