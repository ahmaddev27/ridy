"use client";

import { useEffect } from "react";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { UberCodeLogin } from "@/components/connections/uber-code-login";
import { useAsync } from "@/hooks/use-async";
import { getFleetSession } from "@/lib/api/fleet-session";
import { issueExtensionToken } from "@/lib/api/extension";

export default function ConnectionsPage() {
  const { t } = useI18n();
  const { data, loading, refetch } = useAsync(getFleetSession);

  const c = (k: string) => t(`screens.connections.${k}`);

  // Hidden legacy fallback (never surfaced): a company that still has the old
  // browser extension installed keeps it paired silently. Nothing is offered or
  // required — connecting happens through the co-browse card below.
  useEffect(() => {
    let repaired = false;
    async function pairExtension() {
      const token = await issueExtensionToken();
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || window.location.origin).replace("localhost", "127.0.0.1");
      window.postMessage({ source: "ridy-pair", apiUrl, token }, window.location.origin);
    }
    function onMessage(e: MessageEvent) {
      const d = e.data as { source?: string; paired?: boolean; stale?: boolean };
      if (e.source !== window || d?.source !== "ridy-ext-present") return;
      if (d.stale || d.paired !== false || repaired) return;
      repaired = true;
      pairExtension().catch(() => {});
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "ridy-ext-ping" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const connected = data?.status === "active";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Session broke (cookies rejected / expired): tell the manager offers stopped
          and that signing in again below fixes it. */}
      {data?.status === "needs_relink" && (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">{c("brokenTitle")}</p>
            <p className="mt-0.5 opacity-90">{c("brokenBody")}</p>
          </div>
        </div>
      )}

      {/* Not connected (or needs a fresh sign-in): the co-browse code card is the
          one connect path. */}
      {!connected && !loading && <UberCodeLogin onConnected={refetch} />}

      {loading && (
        <Card className="p-8">
          <div className="flex items-center justify-center py-8 text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        </Card>
      )}

      {connected && (
        <Card className="p-8">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-bg text-success-fg">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-ink">{c("connectedTitle")}</h3>
            <p className="mt-1 text-sm text-ink-muted">{c("connectedBody")}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
