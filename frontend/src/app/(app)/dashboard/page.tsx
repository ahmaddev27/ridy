"use client";

import { useEffect, useState } from "react";
import { latnLocale } from "@/lib/utils";
import { Users, Wifi, Car, Radio, KeyRound } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { RedeemCodeModal } from "@/components/subscription/redeem-code-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getDashboardSummary } from "@/lib/api/dashboard";
import { LiveMap } from "@/components/dashboard/live-map";
import { AdBanner } from "@/components/ads/ad-banner";


export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { data, loading, error, refetch } = useAsync(getDashboardSummary, { refetchInterval: 10000 });
  const [redeemOpen, setRedeemOpen] = useState(false);

  const k = (key: string) => t(`screens.dashboard.${key}`);

  return (
    <div className="space-y-6">
      {/* Sponsored banner — full width, at the top */}
      <AdBanner />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-danger-bg p-3 text-sm text-danger-fg">
          {k("loadError")} — {error}
        </div>
      )}

      {/* Subscription + stat cards (left) beside the live map (right) */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6">
        {data?.subscription && (
          <Card className="flex items-center gap-5 p-5">
            <SubscriptionRing subscription={data.subscription} daysLabel={k("subDaysShort")} />
            <div className="min-w-0">
              <h3 className="font-semibold text-ink">{k("subTitle")}</h3>
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " +
                    (data.subscription.state === null ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg")
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${data.subscription.state === null ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {data.subscription.state === null ? k("subActive") : k("subInactive")}
                </span>
              </div>
              <div className="mt-3 flex gap-5 text-sm">
                <div>
                  <div className="text-xs text-ink-subtle">{k("subActivated")}</div>
                  <div className="font-medium text-ink">
                    {data.subscription.activated_at ? new Date(data.subscription.activated_at).toLocaleDateString(latnLocale(locale)) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-subtle">{k("subEnds")}</div>
                  <div className="font-medium text-ink">
                    {(data.subscription.current_ends_at ?? data.subscription.ends_at)
                      ? new Date((data.subscription.current_ends_at ?? data.subscription.ends_at) as string).toLocaleDateString(latnLocale(locale))
                      : "—"}
                  </div>
                </div>
              </div>
              {data.subscription.queued && (
                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-muted">
                  <span className="font-semibold text-ink">+{data.subscription.queued.days} {k("subDaysShort")}</span>
                  <span className="text-ink-subtle">
                    {k("subQueued")}
                    {data.subscription.queued.starts_at
                      ? ` ${new Date(data.subscription.queued.starts_at).toLocaleDateString(latnLocale(locale))}`
                      : ""}
                  </span>
                </div>
              )}
              <button
                onClick={() => setRedeemOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {k("redeemCode")}
              </button>
            </div>
          </Card>
        )}

          {/* Key stats — 2 per row, under the subscription */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={Wifi}
              label={k("statOnline")}
              value={loading ? "…" : (data?.online_drivers ?? 0)}
              tone={data?.online_drivers ? "positive" : "default"}
            />
            <StatCard icon={Radio} label={k("statOffersToday")} value={loading ? "…" : (data?.offers_today ?? 0)} />
            <StatCard icon={Users} label={k("statDrivers")} value={loading ? "…" : (data?.drivers ?? 0)} />
            <StatCard icon={Car} label={k("statVehicles")} value={loading ? "…" : (data?.vehicles ?? 0)} />
          </div>
        </div>

        {/* Live fleet map — drivers list + statuses live inside it. Height tuned
            so its bottom edge lines up with the subscription + stat cards column. */}
        <div className="lg:col-span-2">
          <h3 className="mb-3 font-semibold text-ink">{t("pages.map.title")}</h3>
          <LiveMap heightClass="h-[352px]" />
        </div>
      </div>

      <RedeemCodeModal open={redeemOpen} onClose={() => setRedeemOpen(false)} onSuccess={refetch} />
    </div>
  );
}

type SubInfo = {
  state: "disabled" | "banned" | "expired" | "inactive" | null;
  days_left: number | null;
  activated_at: string | null;
  ends_at: string | null;
  current_ends_at: string | null;
  current_days_left: number | null;
  queued: { count: number; days: number; starts_at: string | null } | null;
};

/** Compact radial gauge of the subscription — animates its fill on mount. */
function SubscriptionRing({
  subscription,
  daysLabel,
}: {
  subscription: SubInfo;
  daysLabel: string;
}) {
  // The ring reflects the CURRENT period only; queued periods show separately.
  const endsAt = subscription.current_ends_at ?? subscription.ends_at;
  const left = Math.max(0, subscription.current_days_left ?? subscription.days_left ?? 0);
  const total =
    subscription.activated_at && endsAt
      ? Math.max(1, Math.round((new Date(endsAt).getTime() - new Date(subscription.activated_at).getTime()) / 86_400_000))
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
        <span className="text-2xl font-bold tabular-nums text-ink">{left}</span>
        <span className="text-[10px] font-medium text-ink-subtle">{daysLabel}</span>
      </div>
    </div>
  );
}
