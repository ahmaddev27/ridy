"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { AreaChart } from "@/components/charts/area-chart";
import { Badge, type Status } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getDashboardSummary } from "@/lib/api/dashboard";
import { OnlineDrivers } from "@/components/dashboard/online-drivers";

function sessionTone(status: string | undefined): Status {
  if (status === "active") return "connected";
  if (status === "needs_relink" || status === "expired") return "error";
  return "neutral";
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { data, loading, error } = useAsync(getDashboardSummary, { refetchInterval: 10000 });

  const session = data?.fleet_session ?? null;
  const k = (key: string) => t(`screens.dashboard.${key}`);

  return (
    <div className="space-y-6">
      <PageHeader tkey="dashboard" />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {k("loadError")} — {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={k("statDrivers")} value={loading ? "…" : (data?.drivers ?? 0)} />
        <StatCard
          label={k("statOnline")}
          value={loading ? "…" : (data?.online_drivers ?? 0)}
          tone={data?.online_drivers ? "positive" : "default"}
        />
        <StatCard
          label={k("statLinked")}
          value={loading ? "…" : (data?.linked_drivers ?? 0)}
          tone="positive"
        />
        <StatCard label={k("statVehicles")} value={loading ? "…" : (data?.vehicles ?? 0)} />
        <StatCard label={k("statOffersToday")} value={loading ? "…" : (data?.offers_today ?? 0)} />
        <StatCard
          label={k("statUnlinked")}
          value={loading ? "…" : (data?.unlinked_offers ?? 0)}
          tone={data?.unlinked_offers ? "warning" : "default"}
        />
      </div>

      {/* Subscription */}
      {data?.subscription && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="mb-1 font-semibold text-slate-800">{k("subTitle")}</h3>
              <div className="flex items-center gap-2">
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " +
                    (data.subscription.state === null
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700")
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${data.subscription.state === null ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {data.subscription.state === null ? k("subActive") : k("subInactive")}
                </span>
                {data.subscription.days_left !== null && (
                  <span className="text-sm text-slate-500">
                    {k("subDaysLeft").replace("{n}", String(data.subscription.days_left))}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <div className="text-xs text-slate-400">{k("subActivated")}</div>
                <div className="font-medium text-slate-700">
                  {data.subscription.activated_at ? new Date(data.subscription.activated_at).toLocaleDateString(locale) : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">{k("subEnds")}</div>
                <div className="font-medium text-slate-700">
                  {data.subscription.ends_at ? new Date(data.subscription.ends_at).toLocaleDateString(locale) : "—"}
                </div>
              </div>
            </div>
          </div>
          {data.subscription.ends_at && data.subscription.days_left !== null && (
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${data.subscription.days_left <= 3 ? "bg-rose-500" : data.subscription.days_left <= 7 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, Math.max(4, (data.subscription.days_left / 30) * 100))}%` }}
              />
            </div>
          )}
        </Card>
      )}

      {/* Live online drivers */}
      <OnlineDrivers />

      {/* Offers over the last 7 days */}
      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-slate-800">{k("offersTrend")}</h3>
        {loading ? (
          <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />
        ) : (
          <AreaChart
            color="#0f172a"
            data={(data?.offers_daily ?? []).map((d) => ({
              label: new Date(d.date).toLocaleDateString(locale, { weekday: "short" }),
              value: d.count,
            }))}
          />
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-slate-800">{k("sessionTitle")}</h3>
        {loading ? (
          <div className="h-8 w-48 animate-pulse rounded bg-slate-100" />
        ) : session === null ? (
          <p className="text-sm text-slate-400">{k("sessionNone")}</p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{k("sessionStatus")}</span>
              <Badge status={sessionTone(session.status)} dot>
                {session.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{k("sessionOrg")}</span>
              <span className="font-mono text-xs text-slate-600">{session.uber_org_uuid}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{k("sessionLastEvent")}</span>
              <span className="text-slate-600">
                {session.last_event_at ? new Date(session.last_event_at).toLocaleString(locale) : "—"}
              </span>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="font-semibold text-slate-800">{k("driversTitle")}</h3>
          <Link
            href="/drivers"
            className="flex items-center gap-1 text-sm font-medium text-slate-900 hover:text-slate-800"
          >
            {k("manageDrivers")} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </div>
        <div className="px-5 py-4 text-sm text-slate-500">
          {loading
            ? t("common.loading")
            : k("driversSummary")
                .replace("{linked}", String(data?.linked_drivers ?? 0))
                .replace("{total}", String(data?.drivers ?? 0))}
        </div>
      </Card>
    </div>
  );
}
