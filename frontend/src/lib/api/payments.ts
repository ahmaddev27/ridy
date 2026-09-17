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
