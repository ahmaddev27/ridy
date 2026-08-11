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
  reason: "disabled" | "banned" | "expired";
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

  const canActivate = info.reason === "expired";

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
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
        {s(`reason_${info.reason}`)}
      </div>
      <p className="text-sm text-slate-500">{s("contactHint")}</p>

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
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Mail className="h-4 w-4" /> {s("email")}
          </a>
        )}
      </div>

      {canActivate && (
        <form onSubmit={activate} className="mt-6 space-y-3 border-t border-slate-100 pt-5">
          <p className="text-sm font-medium text-slate-700">{s("activateTitle")}</p>
          <p className="text-xs text-slate-400">{s("activateHint")}</p>
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
