"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { redeemSubscriptionCode } from "@/lib/api/company-subscription";

/**
 * Redeem a subscription code from inside the dashboard. A new period stacks
 * after any remaining time. Shared by the Subscription page and the dashboard
 * subscription card so both behave identically.
 */
export function RedeemCodeModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.codes.${k}`);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function redeem() {
    if (code.trim().length !== 6 || submitting) return;
    setSubmitting(true);
    try {
      await redeemSubscriptionCode(code.trim());
      toast.success(c("redeemSuccess"));
      setCode("");
      onClose();
      onSuccess?.();
    } catch (e) {
      toast.error(c("redeemFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={c("redeemTitle")}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">{c("redeemHint")}</p>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-subtle">{c("codeLabel")}</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && redeem()}
            inputMode="numeric"
            placeholder="123456"
            autoFocus
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] tabular-nums text-ink outline-none focus:border-ink"
          />
        </div>
        <Button onClick={redeem} disabled={code.length !== 6 || submitting} className="w-full justify-center">
          {c("activate")}
        </Button>
      </div>
    </Modal>
  );
}
