"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlugZap } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { getFleetSession } from "@/lib/api/fleet-session";

/**
 * App-wide nudge shown when the company's Uber session is not active — either
 * no fleet session exists (e.g. after an admin cut it) or it is expired /
 * needs_relink. Links to the Connections page. Fails safe: if the status can't
 * be fetched, nothing is shown.
 */
export function UberConnectionBanner() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isManager = Boolean(user?.tenant);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    const check = () =>
      getFleetSession()
        .then((s) => {
          if (!cancelled) setDisconnected(!s || s.status !== "active");
        })
        .catch(() => {});
    check();
    // The shell never remounts across navigation; re-check so the banner clears after a relink.
    const poll = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [isManager]);

  if (!isManager || !disconnected) return null;

  return (
    <div className="banner danger" role="alert">
      <PlugZap />
      <span className="grow">{t("uberBanner.text")}</span>
      <Link href="/connections" className="btn btn-secondary btn-sm">
        {t("uberBanner.action")}
      </Link>
    </div>
  );
}
