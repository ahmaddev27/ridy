"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { digitsOnly } from "@/lib/utils";
import { redeemSubscriptionCode } from "@/lib/api/company-subscription";
import { apiErrorMessage } from "@/lib/api/error-message";

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
      toast.error(c("redeemFailed"), { description: apiErrorMessage(e, t) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c("redeemTitle")}
      footer={
        <button type="button" className="btn btn-primary" onClick={redeem} disabled={code.length !== 6 || submitting}>
          <Check />
          {c("activate")}
        </button>
      }
    >
      <div className="stack">
        <p className="muted text-sm">{c("redeemHint")}</p>
        <div className="field">
          <label htmlFor="redeem-code">{c("codeLabel")}</label>
          <input
            id="redeem-code"
            value={code}
            onChange={(e) => setCode(digitsOnly(e.target.value).slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && redeem()}
            inputMode="numeric"
            placeholder="123456"
            autoFocus
            dir="ltr"
            className="input num"
            style={{ textAlign: "center", fontSize: 20, fontWeight: 600, letterSpacing: "0.3em" }}
          />
        </div>
      </div>
    </Modal>
  );
}
