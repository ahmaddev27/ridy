"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plug, LogIn, ChevronDown, Puzzle, Copy, AlertTriangle, Download, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type Status } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getFleetSession, captureFleetSession, deleteFleetSession, type Cookie } from "@/lib/api/fleet-session";
import { issueExtensionToken } from "@/lib/api/extension";
import { LATEST_EXTENSION_VERSION, isExtensionOutdated } from "@/lib/extension";
import { ConfirmModal } from "@/components/ui/confirm-modal";

const statusTone: Record<string, Status> = {
  active: "connected",
  expired: "error",
  needs_relink: "error",
};

/** Accepts an EditThisCookie-style JSON array and reduces it to {name,value}. */
function parseCookies(raw: string, msgArray: string, msgNone: string): Cookie[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(msgArray);
  const cookies = parsed
    .filter((c) => c && typeof c.name === "string" && typeof c.value === "string")
    .map((c) => ({ name: c.name, value: c.value }));
  if (cookies.length === 0) throw new Error(msgNone);
  return cookies;
}

export default function ConnectionsPage() {
  const { t, locale } = useI18n();
  const { data, loading, refetch } = useAsync(getFleetSession);

  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Manual cookie-paste fallback.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [orgUuid, setOrgUuid] = useState("");
  const [cookiesRaw, setCookiesRaw] = useState("");

  // Extension pairing token.
  const [extToken, setExtToken] = useState<string | null>(null);
  const [extBusy, setExtBusy] = useState(false);

  // Whether the Reidey extension is installed (null = still probing).
  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
  // The installed extension's reported version (null = unknown / not reported).
  const [extVersion, setExtVersion] = useState<string | null>(null);

  const c = (k: string) => t(`screens.connections.${k}`);

  // Mint a fresh token and hand it to the extension. Used both by the explicit
  // "connect" button and for silent re-pairing when the extension lost its token.
  async function pairExtension(): Promise<void> {
    const token = await issueExtensionToken();
    setExtToken(token);
    // Use 127.0.0.1 over localhost to dodge the IPv6 loopback pitfall.
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace("localhost", "127.0.0.1");
    window.postMessage({ source: "ridy-pair", apiUrl, token }, "*");
  }

  // Probe for the extension: ping, and if no "present" reply arrives, it's absent.
  // If it's present but unpaired (e.g. reinstalled), re-pair it silently.
  useEffect(() => {
    let repaired = false;
    function onMessage(e: MessageEvent) {
      const d = e.data as { source?: string; version?: string; paired?: boolean };
      if (e.source === window && d?.source === "ridy-ext-present") {
        setExtInstalled(true);
        if (d.version) setExtVersion(d.version);
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
      if (e.source === window && (e.data as { source?: string })?.source === "ridy-pair-ack") {
        toast.success(c("extensionPaired"));
      }
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
      await pairExtension();
      // Give the extension a moment to store the pairing, then open Uber's main
      // fleet portal (supplier.uber.com). The extension's content script runs on
      // both supplier and vsdispatch and captures the shared *.uber.com session
      // once the manager signs in — no need to send them to the dispatch page.
      setTimeout(() => window.open("https://supplier.uber.com/", "_blank"), 500);
    } catch (e) {
      toast.error(c("loginFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setExtBusy(false);
    }
  }

  async function doDisconnect() {
    setBusy(true);
    try {
      await deleteFleetSession();
      toast.success(c("disconnectedToast"));
      await refetch();
    } catch (e) {
      toast.error(c("disconnectFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirmDisconnect(false);
    }
  }

  async function doManualCapture() {
    let cookies: Cookie[];
    try {
      cookies = parseCookies(cookiesRaw, c("cookiesArray"), c("cookiesNone"));
    } catch (e) {
      toast.error(c("cookiesInvalid"), { description: e instanceof Error ? e.message : undefined });
      return;
    }
    if (!orgUuid.trim()) return toast.error(c("orgMissing"));

    setBusy(true);
    try {
      await captureFleetSession({ uber_org_uuid: orgUuid.trim(), cookies });
      toast.success(c("connectedToast"), {
        description: c("connectedToastDesc").replace("{count}", String(cookies.length)),
      });
      setCookiesRaw("");
      await refetch();
    } catch (e) {
      toast.error(c("connectFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Extension not installed: warning + install card with download */}
      {extInstalled === false && (
        <>
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900">{c("extMissingTitle")}</p>
              <p className="mt-0.5 text-sm text-amber-700">{c("extMissingBody")}</p>
            </div>
          </div>

          <Card className="p-5">
            <div className="mb-1 flex items-center gap-2">
              <Download className="h-4 w-4 text-slate-700" />
              <h3 className="font-semibold text-slate-800">{c("installTitle")}</h3>
            </div>
            <p className="mb-3 text-sm text-slate-500">{c("installBody")}</p>
            <ol className="mb-4 ml-4 list-decimal space-y-1 text-sm text-slate-600">
              <li>{c("installStep1")}</li>
              <li>{c("installStep2")}</li>
              <li>{c("installStep3")}</li>
            </ol>
            <a href="/downloads/reidey-extension.zip" download>
              <Button>
                <Download className="h-4 w-4" /> {c("installDownload")}
              </Button>
            </a>
          </Card>
        </>
      )}

      {/* Extension installed but outdated: prompt to update (unpacked builds
          don't auto-update, so the manager must download and reload). */}
      {extInstalled && isExtensionOutdated(extVersion) && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="font-semibold text-amber-900">{c("extUpdateTitle")}</p>
            <p className="mt-0.5 text-sm text-amber-700">
              {c("extUpdateBody")
                .replace("{installed}", extVersion ?? "?")
                .replace("{latest}", LATEST_EXTENSION_VERSION)}
            </p>
            <a href="/downloads/reidey-extension.zip" download className="mt-3 inline-block">
              <Button>
                <Download className="h-4 w-4" /> {c("extUpdateDownload")}
              </Button>
            </a>
          </div>
        </div>
      )}

      {/* Current session */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{c("current")}</h3>
          {loading ? (
            <span className="h-5 w-24 animate-pulse rounded bg-slate-100" />
          ) : data ? (
            <Badge status={statusTone[data.status] ?? "neutral"} dot>
              {c(
                data.status === "active"
                  ? "statusActive"
                  : data.status === "expired"
                    ? "statusExpired"
                    : "statusRelink",
              )}
            </Badge>
          ) : (
            <Badge status="gap" dot>
              {c("notConnected")}
            </Badge>
          )}
        </div>
        {data && (
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">{c("orgUuid")}</span>
              <span className="font-mono text-xs text-slate-600">{data.uber_org_uuid}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{c("lastEvent")}</span>
              <span className="text-slate-600">
                {data.last_event_at ? new Date(data.last_event_at).toLocaleString(locale) : "—"}
              </span>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
                <Trash2 className="h-4 w-4" /> {c("disconnect")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Recommended: browser extension */}
      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-slate-700" />
          <h3 className="font-semibold text-slate-800">{c("extensionTitle")}</h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">{c("extensionHint")}</p>

        {/* One button: mint token -> auto-pair extension -> open Uber. */}
        <Button onClick={connectViaExtension} disabled={extBusy || extInstalled === false}>
          {extBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {c("openUber")}
        </Button>

        {/* Fallback for when the extension isn't installed yet: the raw token. */}
        {extToken && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-slate-500">{c("tokenManualFallback")}</summary>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap text-xs text-slate-700">
                {extToken}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(extToken)}
                className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-200"
                title="Copy"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">{c("tokenHint")}</p>
          </details>
        )}
      </Card>

      {/* Manual fallback */}
      <Card className="p-5">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-slate-600"
        >
          {c("advanced")}
          <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} />
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-500">{c("captureHint")}</p>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{c("orgUuid")}</label>
              <input
                value={orgUuid}
                onChange={(e) => setOrgUuid(e.target.value)}
                placeholder="7b118561-0f8e-4816-a93f-d6e9c770cfd0"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-black focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{c("cookiesLabel")}</label>
              <textarea
                value={cookiesRaw}
                onChange={(e) => setCookiesRaw(e.target.value)}
                rows={6}
                placeholder='[{"name":"sid","value":"..."}]'
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-black focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={doManualCapture} disabled={busy}>
                <Plug className="h-4 w-4" /> {c("connect")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirmDisconnect}
        danger
        title={c("disconnect")}
        message={c("disconnectConfirm")}
        confirmLabel={c("disconnect")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={doDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}
