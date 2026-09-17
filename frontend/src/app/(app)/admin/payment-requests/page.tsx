"use client";

import { PageHeader } from "@/components/ui/page-header";
import { PaymentClaimsList } from "@/components/billing/payment-claims-panel";

/** Super-admin queue + archive of company "I've paid" claims. */
export default function PaymentRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader tkey="paymentRequests" />
      <PaymentClaimsList />
    </div>
  );
}
