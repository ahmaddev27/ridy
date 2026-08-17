"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, UserCog } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { stopImpersonation } from "@/lib/api/admin";

/**
 * Persistent, unmissable banner shown on every authenticated page while a
 * super-admin is acting as a company (impersonation). Ending it reverts the
 * session and hard-reloads back into the admin area so all cached data refetches
 * under the super-admin identity again.
 */
export function ImpersonationBanner() {
  const { t } = useI18n();
  const { impersonating, user } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!impersonating) return null;

  const companyName = user?.tenant?.name ?? null;
  const message = companyName
    ? t("impersonation.banner").replace("{company}", companyName)
    : t("impersonation.bannerNoCompany");

  async function stop() {
    setBusy(true);
    try {
      await stopImpersonation();
      window.location.assign("/admin/companies");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <UserCog className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        onClick={stop}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {t("impersonation.stop")}
      </button>
    </div>
  );
}
