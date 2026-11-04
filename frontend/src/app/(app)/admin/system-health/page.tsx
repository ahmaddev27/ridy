"use client";

import { useState } from "react";
import { Activity, Building2, Server, Boxes, FileText, Trash2, AlertTriangle, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { ShardsPanel } from "@/components/admin/shards-panel";
import { ServerResources } from "@/components/admin/server-resources";
import { InfrastructureHealth } from "@/components/admin/infrastructure-health";
import { LogsPanel } from "@/components/admin/logs-panel";
import { useI18n } from "@/lib/i18n/context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatDateTime, formatNumber, relTime, TOKEN_WARN_MS } from "@/lib/utils";
import { useAsync } from "@/hooks/use-async";
import { getSystemHealth, clearNetworkLogs, type SystemHealthRow } from "@/lib/api/admin";

export default function SystemHealthPage() {
  const { t, locale } = useI18n();
  const isWide = useMediaQuery("(min-width: 768px)");
  const c = (k: string) => t(`screens.systemHealth.${k}`);
  const { data, loading, error } = useAsync(getSystemHealth, { refetchInterval: 30000 });
  const rows = data ?? [];
  const [tab, setTab] = useState<"health" | "services" | "logs" | "shards">("health");

  const tabs = [
    { k: "health", icon: Activity, label: t("nav.systemHealth") },
    { k: "services", icon: Boxes, label: c("infraTitle") },
    { k: "logs", icon: FileText, label: c("logsTitle") },
    { k: "shards", icon: Server, label: t("nav.shards") },
  ] as const;

  return (
    <>
      <header className="ph">
        <div>
          <h1>{t("pages.systemHealth.title")}</h1>
          <p>{t("pages.systemHealth.subtitle")}</p>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {tabs.map(({ k: tk, icon: Icon, label }) => (
          <button
            key={tk}
            type="button"
            role="tab"
            aria-selected={tab === tk}
            className={tab === tk ? "on" : ""}
            onClick={() => setTab(tk)}
          >
            <span className="row" style={{ gap: 7 }}>
              <Icon style={{ width: 16, height: 16 }} />
              {label}
            </span>
          </button>
        ))}
        <span style={{ marginInlineStart: "auto", alignSelf: "center", paddingBottom: 4 }}>
          <button
            type="button"
            className="btn btn-danger-soft btn-sm"
            onClick={async () => {
              if (!confirm(c("clearNetworkConfirm"))) return;
              try {
                const { deleted } = await clearNetworkLogs();
                toast.success(c("clearNetworkDone").replace("{n}", formatNumber(deleted, locale)));
              } catch {
                toast.error(c("clearNetworkFailed"));
              }
            }}
          >
            <Trash2 />
            {c("clearNetwork")}
          </button>
        </span>
      </div>

      {tab === "shards" ? (
        <ShardsPanel />
      ) : tab === "services" ? (
        <InfrastructureHealth />
      ) : tab === "logs" ? (
        <LogsPanel />
      ) : (
        <>
          <ServerResources />

          <section className="card table-card">
            <div className="card-head" style={{ paddingBottom: 12 }}>
              <h2 className="row" style={{ gap: 8 }}>
                <span className="subtle">
                  <Building2 style={{ width: 18, height: 18 }} />
                </span>
                {t("nav.companies")}
              </h2>
            </div>
            {loading && rows.length === 0 ? (
              <div className="stack-sm" style={{ padding: "0 18px 18px" }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skel" style={{ height: 56 }} />
                ))}
              </div>
            ) : error && rows.length === 0 ? (
              <EmptyBlock icon={Activity} title={c("loadError")} text={error} />
            ) : rows.length === 0 ? (
              <EmptyBlock icon={Building2} title={c("emptyTitle")} text={c("emptyDesc")} />
            ) : isWide ? (
              <div className="table-wrap" style={{ borderTop: "1px solid var(--line)" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{c("colCompany")}</th>
                      <th>{c("colSubscription")}</th>
                      <th>{c("colSession")}</th>
                      <th>{c("colDaemon")}</th>
                      <th>{c("colProxy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="strong nowrap">{r.name}</td>
                        <td><SubscriptionCell row={r} c={c} /></td>
                        <td><SessionCell row={r} c={c} locale={locale} /></td>
                        <td><DaemonCell row={r} c={c} locale={locale} /></td>
                        <td><ProxyCell row={r} c={c} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Mobile stacked rows */
              <div className="list-rows" style={{ borderTop: "1px solid var(--line)" }}>
                {rows.map((r) => (
                  <div key={r.id} className="stack-sm" style={{ padding: "14px 18px", gap: 12 }}>
                    <div className="strong">{r.name}</div>
                    <StackRow label={c("colSubscription")}><SubscriptionCell row={r} c={c} /></StackRow>
                    <StackRow label={c("colSession")}><SessionCell row={r} c={c} locale={locale} /></StackRow>
                    <StackRow label={c("colDaemon")}><DaemonCell row={r} c={c} locale={locale} /></StackRow>
                    <StackRow label={c("colProxy")}><ProxyCell row={r} c={c} /></StackRow>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

type Tr = (k: string) => string;

function StackRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
      <span className="subtle text-xs">{label}</span>
      <div style={{ textAlign: "end" }}>{children}</div>
    </div>
  );
}

function EmptyBlock({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text?: string }) {
  return (
    <div className="empty" style={{ borderTop: "1px solid var(--line)" }}>
      <span className="empty-ico"><Icon /></span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}

function Pill({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const tone = ok ? (warn ? "warning" : "success") : warn ? "warning" : "danger";
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

function SubscriptionCell({ row, c }: { row: SystemHealthRow; c: Tr }) {
  const { state, days_left } = row.subscription;
  const ok = state === null;
  // A live subscription with few days left is a soft warning, not a failure.
  const warn = ok && days_left !== null && days_left <= 5;
  const label = ok
    ? days_left === null
      ? c("openEnded")
      : c("daysLeft").replace("{n}", String(days_left))
    : c(`st_${state}`);
  return (
    <Pill ok={ok} warn={warn}>
      {label}
    </Pill>
  );
}

function SessionCell({ row, c, locale }: { row: SystemHealthRow; c: Tr; locale: string }) {
  const { ok, status, last_seen } = row.session;
  // `ok` = the session is ACTIVE *and* recently seen. An active session that has
  // never streamed (no daemon) must NOT read a green "Active" — reflect the real
  // health so the colour and the label agree: amber "Idle" for active-but-silent.
  const active = status === "active";
  const warn = active && !ok;
  // A broken session (Uber rejected the cookies — e.g. the password changed) is
  // actionable, not just "not ok": flag it with an alert icon so an admin can
  // tell "needs re-link" apart from a merely idle/expired session at a glance.
  const brokenRelink = status === "needs_relink";
  const label =
    status === null ? c("noSession") : ok ? c("st_active") : active ? c("st_idle") : c(`st_${status}`);
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <Pill ok={ok} warn={warn}>
        {brokenRelink && <AlertTriangle style={{ width: 12, height: 12 }} />}
        {label}
      </Pill>
      {status !== null && (
        <div className="subtle text-xs">
          {c("lastSeen").replace("{t}", relTime(last_seen, locale, c("never")))}
        </div>
      )}
      <TokenExpiry row={row} c={c} locale={locale} />
    </div>
  );
}

/** Soonest not-yet-expired Uber token. Already-expired ones are not a failure, so they render nothing. */
function TokenExpiry({ row, c, locale }: { row: SystemHealthRow; c: Tr; locale: string }) {
  const now = Date.now();
  const upcoming = [row.session.session_token_expires_at, row.session.supplier_token_expires_at]
    .map((iso) => (iso ? new Date(iso).getTime() : NaN))
    .filter((ms) => Number.isFinite(ms) && ms > now);
  if (upcoming.length === 0) return null;
  const soonest = Math.min(...upcoming);
  const title = formatDateTime(soonest, locale, { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
  return (
    <div
      title={title}
      className={"text-xs " + (soonest - now < TOKEN_WARN_MS ? "warn" : "subtle")}
    >
      {c("tokenExpires").replace("{t}", relTime(new Date(soonest).toISOString(), locale, ""))}
    </div>
  );
}

function DaemonCell({ row, c, locale }: { row: SystemHealthRow; c: Tr; locale: string }) {
  const { ok, last_heartbeat } = row.daemon;
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <Pill ok={ok}>{ok ? c("ok") : c("down")}</Pill>
      <div className="subtle text-xs">
        {c("lastHeartbeat").replace("{t}", relTime(last_heartbeat, locale, c("never")))}
      </div>
    </div>
  );
}

function ProxyCell({ row, c }: { row: SystemHealthRow; c: Tr }) {
  const { ok, label, expires_at } = row.proxy;
  if (label === null) {
    return <Pill ok={false}>{c("noProxy")}</Pill>;
  }
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <Pill ok={ok}>{label}</Pill>
      <div className="subtle text-xs">
        {ok
          ? expires_at
            ? c("proxyExpires").replace("{d}", expires_at)
            : c("openEnded")
          : c("expired")}
      </div>
    </div>
  );
}
