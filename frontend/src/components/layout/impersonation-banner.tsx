"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, UserCog } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { stopImpersonation } from "@/lib/api/admin";
import { apiErrorMessage } from "@/lib/api/error-message";

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
      toast.error(apiErrorMessage(e, t));
      setBusy(false);
    }
  }

  return (
    <div className="banner warning">
      <UserCog />
      <span className="grow">{message}</span>
      <button type="button" onClick={stop} disabled={busy} className="btn btn-secondary btn-sm">
        {busy && <Loader2 className="animate-spin" />}
        {t("impersonation.stop")}
      </button>
    </div>
  );
}
