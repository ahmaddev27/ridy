"use client";

import { Activity, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getSystemHealth, type SystemHealthRow } from "@/lib/api/admin";

export default function SystemHealthPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.systemHealth.${k}`);
  const { data, loading, error } = useAsync(getSystemHealth, { refetchInterval: 30000 });
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader tkey="systemHealth" />

      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : error && rows.length === 0 ? (
          <EmptyState icon={Activity} title={c("loadError")} description={error} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Building2} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{c("colCompany")}</th>
                    <th className="px-4 py-3 font-semibold">{c("colSubscription")}</th>
                    <th className="px-4 py-3 font-semibold">{c("colSession")}</th>
                    <th className="px-4 py-3 font-semibold">{c("colDaemon")}</th>
                    <th className="px-4 py-3 font-semibold">{c("colProxy")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2">
                      <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                      <td className="px-4 py-3">
                        <SubscriptionCell row={r} c={c} />
                      </td>
                      <td className="px-4 py-3">
                        <SessionCell row={r} c={c} locale={locale} />
                      </td>
                      <td className="px-4 py-3">
                        <DaemonCell row={r} c={c} locale={locale} />
                      </td>
                      <td className="px-4 py-3">
                        <ProxyCell row={r} c={c} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <div className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <div key={r.id} className="space-y-3 p-4">
                  <div className="font-semibold text-ink">{r.name}</div>
                  <StackRow label={c("colSubscription")}>
                    <SubscriptionCell row={r} c={c} />
                  </StackRow>
                  <StackRow label={c("colSession")}>
                    <SessionCell row={r} c={c} locale={locale} />
                  </StackRow>
                  <StackRow label={c("colDaemon")}>
                    <DaemonCell row={r} c={c} locale={locale} />
                  </StackRow>
                  <StackRow label={c("colProxy")}>
                    <ProxyCell row={r} c={c} />
                  </StackRow>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

type Tr = (k: string) => string;

function StackRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-ink-subtle">{label}</span>
      <div className="text-end">{children}</div>
    </div>
  );
}

function Pill({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const status: Status = ok ? "connected" : warn ? "expiring" : "error";
  return (
    <Badge status={status} dot>
      {children}
    </Badge>
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
  const label =
    status === null ? c("noSession") : ok ? c("st_active") : active ? c("st_idle") : c(`st_${status}`);
  return (
    <div className="space-y-1">
      <Pill ok={ok} warn={warn}>{label}</Pill>
      {status !== null && (
        <div className="text-[11px] text-ink-subtle">
          {c("lastSeen").replace("{t}", relTime(last_seen, locale, c("never")))}
        </div>
      )}
    </div>
  );
}

function DaemonCell({ row, c, locale }: { row: SystemHealthRow; c: Tr; locale: string }) {
  const { ok, last_heartbeat } = row.daemon;
  return (
    <div className="space-y-1">
      <Pill ok={ok}>{ok ? c("ok") : c("down")}</Pill>
      <div className="text-[11px] text-ink-subtle">
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
    <div className="space-y-1">
      <Pill ok={ok}>{label}</Pill>
      <div className="text-[11px] text-ink-subtle">
        {ok
          ? expires_at
            ? c("proxyExpires").replace("{d}", expires_at)
            : c("openEnded")
          : c("expired")}
      </div>
    </div>
  );
}

/** Short relative time (e.g. "3m ago"). Falls back to `never` when null. */
function relTime(iso: string | null, locale: string, never: string): string {
  if (!iso) return never;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return never;
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale || "en", { numeric: "auto", style: "short" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}
