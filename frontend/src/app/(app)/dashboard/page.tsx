"use client";

import { useEffect, useState } from "react";
import { latnLocale } from "@/lib/utils";
import { Users, Wifi, Link2, Car, Radio, AlertTriangle } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getDashboardSummary } from "@/lib/api/dashboard";
import { LiveMap } from "@/components/dashboard/live-map";

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { data, loading, error } = useAsync(getDashboardSummary, { refetchInterval: 10000 });

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
        <StatCard icon={Users} label={k("statDrivers")} value={loading ? "…" : (data?.drivers ?? 0)} />
        <StatCard
          icon={Wifi}
          label={k("statOnline")}
          value={loading ? "…" : (data?.online_drivers ?? 0)}
          tone={data?.online_drivers ? "positive" : "default"}
        />
        <StatCard
          icon={Link2}
          label={k("statLinked")}
          value={loading ? "…" : (data?.linked_drivers ?? 0)}
          tone="positive"
        />
        <StatCard icon={Car} label={k("statVehicles")} value={loading ? "…" : (data?.vehicles ?? 0)} />
        <StatCard icon={Radio} label={k("statOffersToday")} value={loading ? "…" : (data?.offers_today ?? 0)} />
        <StatCard
          icon={AlertTriangle}
          label={k("statUnlinked")}
          value={loading ? "…" : (data?.unlinked_offers ?? 0)}
          tone={data?.unlinked_offers ? "warning" : "default"}
        />
      </div>

      {/* Subscription + live map — one row, side by side */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        {data?.subscription && (
          <Card className="flex items-center gap-5 p-5">
            <SubscriptionRing subscription={data.subscription} activeLabel={k("subActive")} inactiveLabel={k("subInactive")} daysLabel={k("subDaysShort")} />
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-800">{k("subTitle")}</h3>
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " +
                    (data.subscription.state === null ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${data.subscription.state === null ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {data.subscription.state === null ? k("subActive") : k("subInactive")}
                </span>
              </div>
              <div className="mt-3 flex gap-5 text-sm">
                <div>
                  <div className="text-xs text-slate-400">{k("subActivated")}</div>
                  <div className="font-medium text-slate-700">
                    {data.subscription.activated_at ? new Date(data.subscription.activated_at).toLocaleDateString(latnLocale(locale)) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">{k("subEnds")}</div>
                  <div className="font-medium text-slate-700">
                    {data.subscription.ends_at ? new Date(data.subscription.ends_at).toLocaleDateString(latnLocale(locale)) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Live fleet map — drivers list + statuses live inside it */}
        <div className="lg:col-span-2">
          <h3 className="mb-3 font-semibold text-slate-800">{t("pages.map.title")}</h3>
          <LiveMap heightClass="h-[460px]" />
        </div>
      </div>
    </div>
  );
}

type SubInfo = {
  state: "disabled" | "banned" | "expired" | "inactive" | null;
  days_left: number | null;
  activated_at: string | null;
  ends_at: string | null;
};

/** Compact radial gauge of the subscription — animates its fill on mount. */
function SubscriptionRing({
  subscription,
  daysLabel,
}: {
  subscription: SubInfo;
  activeLabel: string;
  inactiveLabel: string;
  daysLabel: string;
}) {
  const left = Math.max(0, subscription.days_left ?? 0);
  const total =
    subscription.activated_at && subscription.ends_at
      ? Math.max(1, Math.round((new Date(subscription.ends_at).getTime() - new Date(subscription.activated_at).getTime()) / 86_400_000))
      : 30;
  const frac = Math.min(1, left / total);

  const r = 34;
  const circ = 2 * Math.PI * r;
  const color = left <= 3 ? "#e11d48" : left <= 7 ? "#d97706" : "#059669";

  // Animate from empty to the target the first time it mounts (fills on reload).
  const [offset, setOffset] = useState(circ);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(circ * (1 - frac)));
    return () => cancelAnimationFrame(id);
  }, [circ, frac]);

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{left}</span>
        <span className="text-[10px] font-medium text-slate-400">{daysLabel}</span>
      </div>
    </div>
  );
}
