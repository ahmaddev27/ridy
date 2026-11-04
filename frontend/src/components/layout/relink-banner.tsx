"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { useAsync } from "@/hooks/use-async";
import { getFleetSession } from "@/lib/api/fleet-session";

const POLL_MS = 60_000;

/**
 * App-wide alert for managers whose Uber fleet session is dead (needs_relink /
 * expired) — offers are not captured until they reconnect. Mounted once in the
 * app layout so it shows on every page; polls lightly (and on focus) so it
 * clears itself once the session is active again.
 */
export function RelinkBanner() {
  const { user } = useAuth();
  // Tenant users only: super-admins have no fleet session of their own.
  if (!user?.tenant) return null;
  return <RelinkBannerInner />;
}

function RelinkBannerInner() {
  const { t } = useI18n();
  const { data } = useAsync(getFleetSession, { refetchInterval: POLL_MS });
  const status = data?.status;
  if (status !== "needs_relink" && status !== "expired") return null;

  return (
    <div role="alert" className="app-banner app-banner--warning flex items-center gap-3 px-4 py-2 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{t(`relinkBanner.${status}`)}</span>
      <Link href="/connections" className="app-banner__btn rounded-lg px-3 py-1 text-xs font-semibold">
        {t("relinkBanner.action")}
      </Link>
    </div>
  );
}
