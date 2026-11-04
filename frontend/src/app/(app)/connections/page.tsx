"use client";

import { Loader2, CircleCheck, Unplug } from "lucide-react";
import { PageHead } from "@/components/ui/rd";
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
    <div className="stack" style={{ maxWidth: 672, marginInline: "auto", width: "100%" }}>
      <PageHead title={c("title")} sub={c("subtitle")} />

      {/* Session broke (cookies rejected / re-auth needed): offers stopped, so say so, then
          the connect card below drives the relink. */}
      {data?.status === "needs_relink" && (
        <div className="callout danger">
          <Unplug />
          <div className="stack-sm">
            <b>{c("brokenTitle")}</b>
            <span>{c("brokenBody")}</span>
          </div>
        </div>
      )}

      {!connected && !loading && <UberCodeLogin onConnected={refetch} />}

      {(loading || connected) && (
        <section className="card">
          <div className="card-body">
            {loading ? (
              <div className="center-card">
                <Loader2 style={{ animation: "ofr-spin 1s linear infinite", width: 20, height: 20 }} />
              </div>
            ) : (
              <div className="center-card">
                <span className="chip-big success">
                  <CircleCheck />
                </span>
                <h2 style={{ fontSize: 19 }}>{c("connectedTitle")}</h2>
                <p className="muted" style={{ maxWidth: "44ch" }}>{c("connectedBody")}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
