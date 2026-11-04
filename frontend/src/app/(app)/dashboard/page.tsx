"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney, latnLocale } from "@/lib/utils";
import {
  Users,
  Wifi,
  Car,
  Radio,
  KeyRound,
  Wallet,
  Banknote,
  CreditCard,
  MapPin,
  Maximize2,
  CalendarPlus,
  type LucideIcon,
} from "lucide-react";
import { RedeemCodeModal } from "@/components/subscription/redeem-code-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getDashboardSummary } from "@/lib/api/dashboard";
import { LiveMap } from "@/components/dashboard/live-map";
import { WidgetBoundary } from "@/components/widget-boundary";
import { AdBanner } from "@/components/ads/ad-banner";
import { useAuth } from "@/components/auth/auth-provider";
import { useCompanyRealtime } from "@/lib/realtime";

const TZ = "Europe/Berlin";

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { data, loading, error, refetch } = useAsync(getDashboardSummary, { refetchInterval: 10000 });
  const [redeemOpen, setRedeemOpen] = useState(false);

  // Live: refresh the summary (silently) when offers change — coalesced so a
  // burst of events causes one request. The poll stays as the fallback.
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useCompanyRealtime(user?.tenant?.id, () => {
    if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
    realtimeTimer.current = setTimeout(() => void refetch({ silent: true }), 500);
  });
  useEffect(() => () => {
    if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
  }, []);

  const k = (key: string) => t(`screens.dashboard.${key}`);

  // Companies still on the browser extension: ask it to refresh the fleet
  // earnings roll-up (replays getSupplierBreakdownV2 — no Uber tab needed), then
  // reload the summary once it lands. Migrated companies are synced server-side
  // into FleetMetric, which the summary poll above already reads.
  const extensionRetired = user?.tenant?.extension_retired === true;
  useEffect(() => {
    if (extensionRetired) return;
    function onDone(e: MessageEvent) {
      if (e.source === window && (e.data as { source?: string })?.source === "ridy-fleet-earnings-done") {
        setTimeout(() => void refetch({ silent: true }), 400);
      }
    }
    const requestEarnings = () => window.postMessage({ source: "ridy-fetch-fleet-earnings" }, "*");
    window.addEventListener("message", onDone);
    requestEarnings();
    const id = setInterval(requestEarnings, 180_000); // every 3 min while open
    return () => {
      window.removeEventListener("message", onDone);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionRetired]);

  // Set after mount so server and client markup never disagree on "today".
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString(latnLocale(locale), {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: TZ,
      }),
    );
  }, [locale]);

  const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(latnLocale(locale)) : "—");
  const sub = data?.subscription;
  const fm = data?.fleet_metric;
  const cur = fm?.currency ?? "EUR";
  const online = data?.online_drivers ?? 0;
  const shown = (n: number | undefined) => (loading ? "…" : (n ?? 0));
  const firstName = (user?.name ?? "").split(" ")[0];

  return (
    <>
      <header className="ph">
        <div>
          <h1>{k("greeting").replace("{name}", firstName)}</h1>
          <p>{k("fleetDayLine").replace("{date}", today)}</p>
        </div>
        <div className="ph-actions">
          <Link href="/offers" className="btn btn-secondary">
            <Radio />
            {k("viewOffers")}
          </Link>
          <Link href="/map" className="btn btn-primary">
            <MapPin />
            {t("pages.map.title")}
          </Link>
        </div>
      </header>

      {/* Sponsored banner */}
      <AdBanner />

      {error && (
        <div className="callout danger">
          <div>
            {k("loadError")} — {error}
          </div>
        </div>
      )}

      {/* Subscription + stat tiles (left) beside the live map (right) */}
      <div className="g-dash" style={{ alignItems: "start" }}>
        <div className="stack">
          {sub && (
            <section className="card" style={{ padding: 18, display: "flex", gap: 18, alignItems: "center" }}>
              <SubscriptionRing subscription={sub} daysLabel={k("subDaysShort")} />
              <div className="stack-sm grow">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 className="section-title">{k("subTitle")}</h2>
                  <span className={`badge ${sub.state === null ? "success" : "warning"}`}>
                    <span className="dot" />
                    {sub.state === null ? k("subActive") : k("subInactive")}
                  </span>
                </div>
                <div className="g-2" style={{ gap: 10 }}>
                  <div>
                    <div className="subtle text-xs">{k("subActivated")}</div>
                    <div className="strong num">{fmtDate(sub.activated_at)}</div>
                  </div>
                  <div>
                    <div className="subtle text-xs">{k("subEnds")}</div>
                    <div className="strong num">{fmtDate(sub.current_ends_at ?? sub.ends_at)}</div>
                  </div>
                </div>
                {sub.queued && (
                  <span className="row text-sm" style={{ gap: 6, color: "var(--info-fg)" }}>
                    <CalendarPlus style={{ width: 15, height: 15 }} />
                    +{sub.queued.days} {k("subDaysShort")} {k("subQueued")}
                    {sub.queued.starts_at ? ` ${fmtDate(sub.queued.starts_at)}` : ""}
                  </span>
                )}
                <div>
                  <button type="button" onClick={() => setRedeemOpen(true)} className="btn btn-secondary btn-sm">
                    <KeyRound />
                    {k("redeemCode")}
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className="g-2">
            <Stat
              icon={Wifi}
              label={k("statOnline")}
              value={shown(data?.online_drivers)}
              positive={online > 0}
              foot={k("statOnlineFoot").replace("{n}", String(data?.drivers ?? 0))}
            />
            <Stat icon={Radio} label={k("statOffersToday")} value={shown(data?.offers_today)} foot={k("statOffersFoot")} />
            <Stat icon={Users} label={k("statDrivers")} value={shown(data?.drivers)} foot={k("statDriversFoot")} />
            <Stat icon={Car} label={k("statVehicles")} value={shown(data?.vehicles)} />
          </div>
        </div>

        {/* Live fleet map. The map canvas and markers are a carve-out and stay untouched. */}
        <section className="card">
          <div className="card-head">
            <div className="truncate">
              <h2 className="row" style={{ gap: 8 }}>
                <span className="subtle">
                  <MapPin style={{ width: 18, height: 18 }} />
                </span>
                {t("pages.map.title")}
              </h2>
              <div className="sub">{k("mapSub").replace("{n}", String(online))}</div>
            </div>
            <div className="row-wrap">
              <Link href="/map" className="btn btn-ghost btn-sm">
                <Maximize2 />
                {k("fullscreen")}
              </Link>
            </div>
          </div>
          <div style={{ padding: "14px 18px 18px" }}>
            <WidgetBoundary>
              <div className="overflow-hidden" style={{ borderRadius: "var(--r-xl)" }}>
                <LiveMap heightClass="h-[404px]" />
              </div>
            </WidgetBoundary>
          </div>
        </section>
      </div>

      {/* Fleet-wide Uber earnings: total, cash the drivers hold, net paid out. */}
      <section className="card">
        <div className="card-head">
          <h2 className="row" style={{ gap: 8 }}>
            <span className="subtle">
              <Wallet style={{ width: 18, height: 18 }} />
            </span>
            {k("fleetEarnings")}
          </h2>
          {fm?.synced_at && (
            <span className="subtle text-sm" dir="ltr">
              {k("fleetSynced").replace(
                "{date}",
                new Date(fm.synced_at).toLocaleString(latnLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: TZ }),
              )}
            </span>
          )}
        </div>
        <div className="card-body">
          {fm ? (
            <>
              <div className="g-3">
                <FleetTile icon={Wallet} label={k("fleetEarnings")} value={formatMoney(fm.earnings, locale, cur)} />
                <FleetTile icon={Banknote} label={k("fleetCash")} value={formatMoney(fm.cash_collected, locale, cur)} tone="warning" />
                <FleetTile icon={CreditCard} label={k("fleetNet")} value={formatMoney(fm.net_outstanding, locale, cur)} tone="success" />
              </div>
              <p className="subtle text-sm" style={{ marginTop: 12 }}>
                {k("fleetEarningsHint")}
              </p>
            </>
          ) : (
            <p className="subtle text-sm">{k("fleetEarningsEmpty")}</p>
          )}
        </div>
      </section>

      <RedeemCodeModal open={redeemOpen} onClose={() => setRedeemOpen(false)} onSuccess={refetch} />
    </>
  );
}

/** Prototype stat tile: icon chip + label, big tabular value, quiet footer line. */
function Stat({
  icon: Icon,
  label,
  value,
  foot,
  positive,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  foot?: string;
  positive?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span className={`stat-ico${positive ? " success" : ""}`}>
          <Icon />
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`stat-value${positive ? " pos" : ""}`}>{value}</div>
      {foot && (
        <div className="stat-foot">
          <span className="truncate">{foot}</span>
        </div>
      )}
    </div>
  );
}

function FleetTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "warning" | "success";
}) {
  return (
    <div className="card inset" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="stat-top">
        <span className={`stat-ico ${tone ?? ""}`}>
          <Icon />
        </span>
        {label}
      </div>
      <div className="stat-value" dir="ltr">
        {value}
      </div>
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
function SubscriptionRing({ subscription, daysLabel }: { subscription: SubInfo; daysLabel: string }) {
  // The ring reflects the CURRENT period only; queued periods show separately.
  const endsAt = subscription.current_ends_at ?? subscription.ends_at;
  const left = Math.max(0, subscription.current_days_left ?? subscription.days_left ?? 0);
  const total =
    subscription.activated_at && endsAt
      ? Math.max(1, Math.round((new Date(endsAt).getTime() - new Date(subscription.activated_at).getTime()) / 86_400_000))
      : 30;
  const frac = Math.min(1, left / total);

  const r = 40;
  const circ = 2 * Math.PI * r;
  const color = left <= 3 ? "var(--danger-dot)" : left <= 7 ? "var(--warning-dot)" : "var(--c1)";

  // Animate from empty to the target the first time it mounts (fills on reload).
  const [offset, setOffset] = useState(circ);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(circ * (1 - frac)));
    return () => cancelAnimationFrame(id);
  }, [circ, frac]);

  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${left} ${daysLabel}`} style={{ flexShrink: 0 }}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)" }}
      />
      <text x="48" y="50" textAnchor="middle" style={{ font: "650 24px var(--font-sans)", fill: "var(--ink)" }}>
        {left}
      </text>
      <text x="48" y="66" textAnchor="middle" style={{ font: "500 10px var(--font-sans)", fill: "var(--ink-subtle)" }}>
        {daysLabel}
      </text>
    </svg>
  );
}
