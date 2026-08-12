"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { activateCompany } from "@/lib/api/activation";

export type SuspendedInfo = {
  reason: "disabled" | "banned" | "expired" | "inactive";
  email: string;
  password: string;
  supportEmail?: string | null;
  supportWhatsapp?: string | null;
};

/**
 * Shown when a company is blocked from signing in. "expired" lets the owner
 * enter the admin's activation code; "disabled"/"banned" only offer support
 * contact (an admin must lift those).
 */
export function SuspendedScreen({
  info,
  onActivated,
}: {
  info: SuspendedInfo;
  onActivated: () => void;
}) {
  const { t } = useI18n();
  const s = (k: string) => t(`suspended.${k}`);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const canActivate = info.reason === "expired" || info.reason === "inactive";

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await activateCompany(info.email, info.password, code.trim());
      toast.success(s("activated"));
      onActivated();
    } catch (err) {
      toast.error(s("activateFailed"), { description: apiErrorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const wa = info.supportWhatsapp?.replace(/[^\d]/g, "");

  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <div className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger-fg">
        {s(`reason_${info.reason}`)}
      </div>
      <p className="text-sm text-ink-muted">{s("contactHint")}</p>

      <div className="mt-4 flex flex-col gap-2">
        {wa && (
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="h-4 w-4" /> {s("whatsapp")}
          </a>
        )}
        {info.supportEmail && (
          <a
            href={`mailto:${info.supportEmail}`}
            className="flex items-center justify-center gap-2 rounded-lg border border-line-strong px-3 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2"
          >
            <Mail className="h-4 w-4" /> {s("email")}
          </a>
        )}
      </div>

      {canActivate && (
        <form onSubmit={activate} className="mt-6 space-y-3 border-t border-line pt-5">
          <p className="text-sm font-medium text-ink">{s("activateTitle")}</p>
          <p className="text-xs text-ink-subtle">{s("activateHint")}</p>
          <div className="py-1">
            <OtpInput value={code} onChange={setCode} autoFocus />
          </div>
          <Button type="submit" disabled={busy || code.length < 6} className="w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {s("activateCta")}
          </Button>
        </form>
      )}
    </div>
  );
}
