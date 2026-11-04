"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, CircleCheck, TriangleAlert, Download, Unplug, RefreshCw } from "lucide-react";
import { PageHead } from "@/components/ui/rd";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { UberCodeLogin } from "@/components/connections/uber-code-login";
import { useAsync } from "@/hooks/use-async";
import { getFleetSession, prepareReconnect } from "@/lib/api/fleet-session";
import { issueExtensionToken } from "@/lib/api/extension";
import { LATEST_EXTENSION_VERSION, EXTENSION_STORE_URL, isExtensionOutdated } from "@/lib/extension";

export default function ConnectionsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
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
      setTimeout(() => window.open("https://fleethub.uber.com/", "_blank"), 500);
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
    // Depend ONLY on awaitingLink: including `data` restarted this effect on every
    // 3s refetch, which reset the 120s stop timer so it never fired (endless poll).
    const poll = setInterval(() => refetch(), 3000);
    const stop = setTimeout(() => setAwaitingLink(false), 120000);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingLink]);

  // Flip the card to "connected" the moment a poll reports an active session.
  useEffect(() => {
    if (awaitingLink && data?.status === "active") {
      setAwaitingLink(false);
      toast.success(c("connectedToast"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingLink, data]);

  const connected = data?.status === "active";
  // Email + code is THE connect path (warm company, or cold with the cold flag on); the extension
  // is then neither offered nor nagged. A never-connected company without cold keeps the extension.
  const passwordless = user?.tenant?.passwordless_primary === true;
  const working = extBusy || awaitingLink;

  const spin = { animation: "ofr-spin 1s linear infinite" };

  return (
    <div className="stack" style={{ maxWidth: 672, marginInline: "auto", width: "100%" }}>
      <PageHead title={c("title")} sub={c("subtitle")} />

      {/* Installed but outdated: a light, non-blocking nudge. */}
      {!passwordless && extInstalled && isExtensionOutdated(extVersion) && (
        <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="callout warning">
          <TriangleAlert />
          <div>
            {c("extUpdateBody")
              .replace("{installed}", extVersion ?? "?")
              .replace("{latest}", LATEST_EXTENSION_VERSION)}
          </div>
        </a>
      )}

      {/* Session broke (e.g. the Uber password changed → cookies rejected): the
          prominent alert that drives the reconnect flow. */}
      {data?.status === "needs_relink" && !passwordless && (
        <div className="callout danger">
          <Unplug />
          <div className="stack-sm">
            <b>{c("brokenTitle")}</b>
            <span>{c("brokenBody")}</span>
            <span>
              <button type="button" className="btn btn-danger btn-sm" onClick={connectViaExtension} disabled={working}>
                {working ? <Loader2 style={spin} /> : <RefreshCw />}
                {c("reconnect")}
              </button>
            </span>
          </div>
        </div>
      )}

      {/* Passwordless company, not connected: the code card is the primary (only) connect path. */}
      {passwordless && !connected && !loading && <UberCodeLogin onConnected={refetch} />}

      {(!passwordless || connected) && (
        <section className="card">
          <div className="card-body">
            {loading || extInstalled === null ? (
              <div className="center-card">
                <span className="skel" style={{ width: 56, height: 56, borderRadius: 18 }} />
                <span className="skel" style={{ height: 16, width: 180 }} />
                <span className="skel" style={{ height: 12, width: 260 }} />
              </div>
            ) : connected ? (
              <div className="center-card">
                <span className="chip-big success">
                  <CircleCheck />
                </span>
                <h2 style={{ fontSize: 19 }}>{c("connectedTitle")}</h2>
                <p className="muted" style={{ maxWidth: "44ch" }}>{c("connectedBody")}</p>
                {!passwordless && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={connectViaExtension} disabled={working}>
                    {working ? <Loader2 style={spin} /> : <RefreshCw />}
                    {c("reconnect")}
                  </button>
                )}
              </div>
            ) : (
              <div className="center-card">
                <span className="chip-big">
                  <LogIn />
                </span>
                <h2 style={{ fontSize: 19 }}>{c("connectUber")}</h2>
                <p className="muted" style={{ maxWidth: "46ch" }}>
                  {extInstalled ? c("connectInstalledHint") : c("connectInstallHint")}
                </p>
                {awaitingLink ? (
                  <div className="row" style={{ gap: 10, color: "var(--ink-muted)" }}>
                    <Loader2 style={{ ...spin, width: 16, height: 16 }} />
                    <span>{c("awaitingLink")}</span>
                  </div>
                ) : extInstalled ? (
                  <button type="button" className="btn btn-primary btn-lg" onClick={connectViaExtension} disabled={working}>
                    {working ? <Loader2 style={spin} /> : <LogIn />}
                    {c("connectUber")}
                  </button>
                ) : (
                  <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
                    <Download />
                    {c("connectUber")}
                  </a>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
