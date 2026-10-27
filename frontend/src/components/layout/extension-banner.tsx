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

  useEffect(() => {
    if (!isManager) return;
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
  }, [isManager]);

  if (!isManager || dismissed || state === "checking" || state === "ok") return null;

  const message = t(`extBanner.${state}`);

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-warning-bg px-4 py-2 text-sm text-amber-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <Link
        href="/connections"
        className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
      >
        {t("extBanner.action")}
      </Link>
      <button onClick={() => setDismissed(true)} className="rounded p-1 text-amber-500 hover:bg-warning-bg" aria-label={t("common.dismiss")}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
