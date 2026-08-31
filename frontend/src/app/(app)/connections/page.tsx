"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getFleetSession, prepareReconnect } from "@/lib/api/fleet-session";
import { issueExtensionToken } from "@/lib/api/extension";
import { LATEST_EXTENSION_VERSION, EXTENSION_STORE_URL, isExtensionOutdated } from "@/lib/extension";

export default function ConnectionsPage() {
  const { t } = useI18n();
  const { data, loading, refetch } = useAsync(getFleetSession);

  // True while we wait for the extension to capture the session in the Uber tab,
  // so the page can poll and flip to "connected" on its own — no manual reload.
  const [awaitingLink, setAwaitingLink] = useState(false);
  const [extBusy, setExtBusy] = useState(false);

  // Whether Reidey is installed (null = still probing).
  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
  // The installed extension's reported version (null = unknown / not reported).
  const [extVersion, setExtVersion] = useState<string | null>(null);

  const c = (k: string) => t(`screens.connections.${k}`);

  // Mint a fresh token and hand it to the extension. Used both by the explicit
  // "connect" button and for silent re-pairing when the extension lost its token.
  async function pairExtension(): Promise<void> {
    const token = await issueExtensionToken();
    // Same-origin in production (empty NEXT_PUBLIC_API_URL) -> use the domain the
    // manager is actually on, so the extension pairs against whichever domain
    // served the dashboard. Use 127.0.0.1 over localhost to dodge IPv6 loopback.
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || window.location.origin).replace("localhost", "127.0.0.1");
    window.postMessage({ source: "ridy-pair", apiUrl, token }, window.location.origin);
  }

  // Probe for the extension: ping, and if no "present" reply arrives, it's absent.
  // If it's present but unpaired (e.g. reinstalled), re-pair it silently.
  useEffect(() => {
    let repaired = false;
    let staleWarned = false;
    function onMessage(e: MessageEvent) {
      const d = e.data as { source?: string; version?: string; paired?: boolean; stale?: boolean };
      if (e.source === window && d?.source === "ridy-ext-present") {
        setExtInstalled(true);
        if (d.version) setExtVersion(d.version);
        // A stale content script (extension was updated/reloaded under an open
        // page) can neither pair nor capture. Re-pairing can't fix it — only a
        // reload re-injects a live script — so prompt that instead of looping.
        if (d.stale) {
          if (!staleWarned) {
            staleWarned = true;
            toast.error(c("extensionStale"));
          }
          return;
        }
        if (d.paired === false && !repaired) {
          repaired = true;
          pairExtension().catch(() => {});
        }
      }
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "ridy-ext-ping" }, "*");
    const timer = setTimeout(() => setExtInstalled((v) => v ?? false), 800);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confirmation that the installed extension picked up the pairing.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const src = (e.data as { source?: string })?.source;
      if (e.source !== window) return;
      if (src === "ridy-pair-ack") toast.success(c("extensionPaired"));
      // Pairing couldn't be stored because the content script is stale — a reload
      // fixes it. Surface it so the manager isn't left on a silent "not paired".
      if (src === "ridy-pair-fail") toast.error(c("extensionStale"));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * One click does everything: mint a token, hand it to the extension (auto-pair),
   * then open Uber so the extension captures the session after the manager signs in.
   */
  async function connectViaExtension() {
    setExtBusy(true);
    try {
      // Clear any autolink block server-side FIRST, so the capture that follows
      // is accepted even from an older extension that can't send `manual`.
      await prepareReconnect();
      await pairExtension();
      // Tell the extension THIS is an explicit connect, so it auto-closes the tab
      // it's about to open (but never a supplier tab the manager opens later).
      window.postMessage({ source: "ridy-connect-intent" }, "*");
      // Send the manager to the Uber fleet portal (supplier) — their familiar
      // driver-management site. The browser lands on /orgs/<uuid>/, so the
      // extension reads the fleet org straight from the URL and captures the
      // session. It then shows "connected" and closes the tab; all data pulls
      // run in the background afterwards.
      setTimeout(() => window.open("https://supplier.uber.com/", "_blank"), 500);
      // Start polling so the card flips to "connected" once the extension captures.
      setAwaitingLink(true);
    } catch (e) {
      toast.error(c("loginFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setExtBusy(false);
    }
  }

  // While awaiting the link, poll the session every 3s (capped at 2 min). The
  // extension captures in a separate Uber tab, so this dashboard tab has no other
  // signal — polling flips the card to "connected" the moment the session lands.
  useEffect(() => {
    if (!awaitingLink) return;
    if (data?.status === "active") {
      setAwaitingLink(false);
      toast.success(c("connectedToast"));
      return;
    }
    const poll = setInterval(() => refetch(), 3000);
    const stop = setTimeout(() => setAwaitingLink(false), 120000);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingLink, data]);

  const connected = data?.status === "active";
  const working = extBusy || awaitingLink;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Installed but outdated: a light, non-blocking nudge (kept trivial). */}
      {extInstalled && isExtensionOutdated(extVersion) && (
        <a
          href={EXTENSION_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-xl border border-line bg-warning-bg px-4 py-3 text-sm text-warning-fg transition hover:opacity-90"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {c("extUpdateBody")
              .replace("{installed}", extVersion ?? "?")
              .replace("{latest}", LATEST_EXTENSION_VERSION)}
          </span>
        </a>
      )}

      <Card className="p-8">
        {loading || extInstalled === null ? (
          <div className="flex items-center justify-center py-8 text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : connected ? (
          // ── Connected: clean success card ──────────────────────────────
          <div className="flex flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-bg text-success-fg">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-ink">{c("connectedTitle")}</h3>
            <p className="mt-1 text-sm text-ink-muted">{c("connectedBody")}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-6"
              onClick={connectViaExtension}
              disabled={working}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {c("reconnect")}
            </Button>
          </div>
        ) : (
          // ── Not connected: one primary action ──────────────────────────
          <div className="flex flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted">
              <LogIn className="h-7 w-7" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-ink">{c("connectUber")}</h3>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              {extInstalled ? c("connectInstalledHint") : c("connectInstallHint")}
            </p>

            {extInstalled ? (
              <Button className="mt-6" onClick={connectViaExtension} disabled={working}>
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {c("connectUber")}
              </Button>
            ) : (
              <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="mt-6">
                <Button>
                  <Download className="h-4 w-4" /> {c("connectUber")}
                </Button>
              </a>
            )}

            {awaitingLink && (
              <p className="mt-4 flex items-center gap-1.5 text-sm text-ink-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {c("awaitingLink")}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
