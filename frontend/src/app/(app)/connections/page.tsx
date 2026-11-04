"use client";

import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { UberCodeLogin } from "@/components/connections/uber-code-login";
import { useAsync } from "@/hooks/use-async";
import { getFleetSession } from "@/lib/api/fleet-session";

/**
 * Co-browse / passwordless connect is the ONLY way to link Uber (the browser extension no
 * longer connects anyone). Connected -> success card; otherwise the code/co-browse card.
 */
export default function ConnectionsPage() {
  const { t } = useI18n();
  const { data, loading, refetch } = useAsync(getFleetSession);

  const c = (k: string) => t(`screens.connections.${k}`);
  const connected = data?.status === "active";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Session broke (cookies rejected / re-auth needed): offers stopped, so say so, then
          the connect card below drives the relink. */}
      {data?.status === "needs_relink" && (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">{c("brokenTitle")}</p>
            <p className="mt-0.5 opacity-90">{c("brokenBody")}</p>
          </div>
        </div>
      )}

      {!connected && !loading && <UberCodeLogin onConnected={refetch} />}

      {(loading || connected) && (
        <Card className="p-8">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-ink-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-bg text-success-fg">
                <CheckCircle2 className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-ink">{c("connectedTitle")}</h3>
              <p className="mt-1 text-sm text-ink-muted">{c("connectedBody")}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
