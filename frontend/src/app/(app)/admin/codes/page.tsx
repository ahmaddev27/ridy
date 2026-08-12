"use client";

import { PageHeader } from "@/components/ui/page-header";
import { CodesLedger } from "@/components/billing/codes-ledger";
import { listSubscriptionCodes, exportSubscriptionCodes } from "@/lib/api/admin";

/** Admin-wide ledger of every issued activation code (all resellers + admin). */
export default function AdminCodesPage() {
  return (
    <div className="space-y-6">
      <PageHeader tkey="codes" />
      <CodesLedger fetchCodes={listSubscriptionCodes} exportCodes={exportSubscriptionCodes} showCollector />
    </div>
  );
}
