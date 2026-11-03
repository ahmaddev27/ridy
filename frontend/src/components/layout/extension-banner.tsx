"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { isExtensionOutdated } from "@/lib/extension";

type State = "checking" | "missing" | "outdated" | "unpaired" | "ok";

/**
 * App-wide banner nudging the manager to install / update / pair the Reidey
 * extension — shown on every page (offers/roster capture depends on it). The
 * extension announces itself via `ridy-ext-present`; we ping and wait briefly.
 */
export function ExtensionBanner() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [state, setState] = useState<State>("checking");
  const [dismissed, setDismissed] = useState(false);

  const isManager = Boolean(user?.tenant);
  // A passwordless company connects with email + code and never needs the extension.
  const passwordless = user?.tenant?.passwordless_primary === true;
  // A company migrated to server-side sync has retired the extension entirely.
  const retired = user?.tenant?.extension_retired === true;

  useEffect(() => {
    if (!isManager || passwordless || retired) return;
    let answered = false;

    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.data?.source !== "ridy-ext-present") return;
      answered = true;
      const version: string | null = e.data.version ?? null;
      const paired: boolean = Boolean(e.data.paired);
      if (isExtensionOutdated(version)) setState("outdated");
      else if (!paired) setState("unpaired");
      else setState("ok");
    }

    window.addEventListener("message", onMessage);
    const ping = () => window.postMessage({ source: "ridy-ext-ping" }, "*");
    ping();
    // Re-ping so the banner reflects pairing live: it lives in the app layout and
    // never remounts across navigation, so after the manager fixes pairing or
    // reconnects on /connections a one-shot check would stay stale ("isn't paired
    // yet") until a full page reload. A fresh "present/paired" reply flips it to ok.
    const poll = setInterval(ping, 5000);
    const timer = setTimeout(() => {
      if (!answered) setState("missing");
    }, 2500);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, [isManager, passwordless, retired]);

  if (!isManager || passwordless || retired || dismissed || state === "checking" || state === "ok") return null;

  const message = t(`extBanner.${state}`);

  return (
    <div className="banner warning">
      <AlertTriangle />
      <span className="grow">{message}</span>
      <Link href="/connections" className="btn btn-secondary btn-sm">
        {t("extBanner.action")}
      </Link>
      <button type="button" onClick={() => setDismissed(true)} className="icon-btn" aria-label={t("common.dismiss")}>
        <X />
      </button>
    </div>
  );
}
