"use client";

import Link from "next/link";
import { latnLocale } from "@/lib/utils";
import { AlertTriangle, Building2, Radio, Plug, ArrowRight, ArrowUpRight, Users, Wallet, TrendingUp, Clock, ReceiptText, type LucideIcon } from "lucide-react";
import { AreaChart } from "@/components/charts/area-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getOverview, getBillingSummary } from "@/lib/api/admin";

const SESSION_COLORS = { active: "#059669", needs_relink: "#d97706", expired: "#e11d48", no_session: "#94a3b8" };

export default function AdminDashboardPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.adminDashboard.${k}`);
  const { data } = useAsync(getOverview, { refetchInterval: 20000 });
  const { data: billing } = useAsync(getBillingSummary, { refetchInterval: 60000 });

  const s = data?.stats;
  const alerts = data?.alerts ?? [];
  const expiringProxies = data?.expiring_proxies ?? [];
  const breakdown = data?.session_breakdown;
  const offersChart = (data?.offers_daily ?? []).map((d) => ({
    label: new Date(d.date).toLocaleDateString(latnLocale(locale), { month: "numeric", day: "numeric" }),
    value: d.count,
  }));
  const top = data?.top_companies ?? [];
  const topMax = Math.max(1, ...top.map((tc) => tc.offers));
  const dTotal = s?.drivers_total ?? 0;
  const dOnline = s?.drivers_online ?? 0;
  const dRate = dTotal > 0 ? Math.round((dOnline / dTotal) * 100) : 0;

  const money = (n: number) => new Intl.NumberFormat(latnLocale(locale), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  const revenueChart = (billing?.revenue_by_month ?? []).map((r) => ({ label: r.month.slice(5), value: r.total }));
  const thisMonth = billing?.revenue_by_month.at(-1)?.total ?? 0;

  const sessionSegments = breakdown
    ? ([
        { key: "active", value: breakdown.active, color: SESSION_COLORS.active },
        { key: "needs_relink", value: breakdown.needs_relink, color: SESSION_COLORS.needs_relink },
        { key: "expired", value: breakdown.expired, color: SESSION_COLORS.expired },
        { key: "no_session", value: breakdown.no_session, color: SESSION_COLORS.no_session },
      ] as const)
    : [];
  const sessionsTotal = sessionSegments.reduce((a, x) => a + x.value, 0);

  return (
    <>
      <header className="ph">
        <div>
          <h1>{t("pages.adminDashboard.title")}</h1>
          <p>{t("pages.adminDashboard.subtitle")}</p>
        </div>
      </header>

      {/* Hero KPIs */}
      <div className="g-4">
        <Kpi icon={Building2} href="/admin/companies" label={c("companies")} value={s?.companies} sub={`${s?.active_companies ?? 0} ${c("activeShort")}`} />
        <Kpi icon={Users} href="/admin/companies" label={c("drivers")} value={s?.drivers} sub={`${(s?.offers ?? 0).toLocaleString(latnLocale(locale))} ${c("offersTotal")}`} />
        <Kpi icon={Radio} href="/admin/companies" label={c("sessionsActive")} value={s?.sessions_active} tone="positive" />
        <Kpi icon={Wallet} href="/admin/reports" label={c("totalRevenue")} value={billing ? money(billing.totals.total_revenue) : undefined} tone="positive" />
      </div>

      <div className="g-main-side" style={{ alignItems: "start" }}>
        {/* Billing & subscriptions */}
        <section className="card">
          <div className="card-head">
            <h2 className="row" style={{ gap: 8 }}>
              <span className="subtle">
                <ReceiptText style={{ width: 18, height: 18 }} />
              </span>
              {c("billingTitle")}
            </h2>
            <Link href="/admin/reports" className="btn btn-ghost btn-sm" aria-label={c("billingTitle")}>
              <ArrowRight className="rtl:rotate-180" />
            </Link>
          </div>
          <div className="card-body">
            <div className="g-main-side" style={{ alignItems: "center" }}>
              <div>
                <div className="subtle text-xs" style={{ marginBottom: 8 }}>{c("revenueChart")}</div>
                {revenueChart.length > 0 ? (
                  <AreaChart data={revenueChart} color="#10b981" valueFormat={money} />
                ) : (
                  <p className="muted" style={{ padding: "50px 0", textAlign: "center" }}>{c("revenueEmpty")}</p>
                )}
              </div>
              <div className="g-2" style={{ gap: 14 }}>
                <Mini icon={TrendingUp} label={c("monthlyRevenue")} value={billing ? money(thisMonth) : "…"} tone="pos" />
                <Mini icon={Wallet} label={c("outstanding")} value={billing ? money(billing.totals.outstanding) : "…"} tone={billing?.totals.outstanding ? "warn" : ""} />
                <Mini icon={ReceiptText} label={c("activeSubs")} value={billing?.totals.active_subscriptions ?? "…"} />
                <Mini icon={Clock} label={c("expiringSoon")} value={billing?.totals.expiring_soon ?? "…"} tone={billing?.totals.expiring_soon ? "warn" : ""} />
              </div>
            </div>
          </div>
        </section>

        {/* Drivers: live fleet stat, links to the directory */}
        <Link href="/admin/drivers" className="card hover" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="section-title row" style={{ gap: 8 }}>
              <span className="live-dot" />
              {c("driversTitle")}
            </h2>
            <ArrowUpRight className="subtle rtl:-scale-x-100" style={{ width: 15, height: 15 }} />
          </div>
          <div className="g-3" style={{ gap: 10, textAlign: "center" }}>
            {[
              { label: c("dOnline"), value: dOnline.toLocaleString(latnLocale(locale)), cls: "pos" },
              { label: c("dRate"), value: `${dRate}%`, cls: "" },
              { label: c("dTotal"), value: dTotal.toLocaleString(latnLocale(locale)), cls: "" },
            ].map((x) => (
              <div key={x.label}>
                <div className={`stat-value ${x.cls}`} dir="ltr">{x.value}</div>
                <div className="subtle text-xs" style={{ marginTop: 4 }}>{x.label}</div>
              </div>
            ))}
          </div>
        </Link>
      </div>

      {/* Offers over time */}
      <section className="card">
        <div className="card-head">
          <h2 className="row" style={{ gap: 8 }}>
            <span className="subtle">
              <Radio style={{ width: 18, height: 18 }} />
            </span>
            {c("offersChart")}
          </h2>
        </div>
        <div className="card-body">
          {offersChart.length > 0 ? <BarChart data={offersChart} /> : <div className="h-[180px] animate-pulse rounded-lg bg-surface-2" />}
        </div>
      </section>

      <div className="g-3" style={{ alignItems: "start" }}>
        {/* Companies health: active vs inactive donut */}
        <section className="card">
          <div className="card-head"><h2>{c("companiesHealth")}</h2></div>
          <div className="card-body">
            <div className="flex items-center gap-6">
              <DonutChart
                segments={[
                  { value: s?.active_companies ?? 0, color: "#10b981" },
                  { value: Math.max(0, (s?.companies ?? 0) - (s?.active_companies ?? 0)), color: "#94a3b8" },
                ]}
                total={s?.companies ?? 0}
              />
              <div className="stack-sm grow">
                <LegendRow color="#10b981" label={c("cActive")} value={s?.active_companies ?? 0} />
                <LegendRow color="#94a3b8" label={c("cInactive")} value={Math.max(0, (s?.companies ?? 0) - (s?.active_companies ?? 0))} />
              </div>
            </div>
          </div>
        </section>

        {/* Session health: donut */}
        <section className="card">
          <div className="card-head"><h2>{c("healthTitle")}</h2></div>
          <div className="card-body">
            <div className="flex items-center gap-6">
              <DonutChart segments={sessionSegments} total={sessionsTotal} />
              <div className="stack-sm grow">
                <LegendRow color={SESSION_COLORS.active} label={c("stActive")} value={breakdown?.active ?? 0} />
                <LegendRow color={SESSION_COLORS.needs_relink} label={c("stNeedsRelink")} value={breakdown?.needs_relink ?? 0} />
                <LegendRow color={SESSION_COLORS.expired} label={c("stExpired")} value={breakdown?.expired ?? 0} />
                <LegendRow color={SESSION_COLORS.no_session} label={c("stNoSession")} value={breakdown?.no_session ?? 0} />
              </div>
            </div>
          </div>
        </section>

        {/* Top companies */}
        <section className="card">
          <div className="card-head"><h2>{c("topCompanies")}</h2></div>
          <div className="card-body">
            {top.length === 0 ? (
              <p className="muted">—</p>
            ) : (
              <div className="stack">
                {top.map((tc) => (
                  <div key={tc.company_id} className="stack-sm" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="strong truncate">{tc.company}</span>
                      <span className="num subtle">{tc.offers.toLocaleString(latnLocale(locale))}</span>
                    </div>
                    <div className="meter">
                      <i style={{ width: `${(tc.offers / topMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Alerts */}
      <section className="card">
        <div className="card-head" style={{ paddingBottom: 6 }}>
          <h2 className="row" style={{ gap: 8 }}>
            <span className="subtle">
              <AlertTriangle style={{ width: 18, height: 18 }} />
            </span>
            {c("alerts")}
          </h2>
        </div>
        {alerts.length === 0 && expiringProxies.length === 0 ? (
          <p className="muted" style={{ padding: "8px 18px 18px" }}>{c("noAlerts")}</p>
        ) : (
          <div className="list-rows" style={{ marginTop: 8, borderTop: "1px solid var(--line)" }}>
            {expiringProxies.map((p) => (
              <div key={`px-${p.id}`} className="list-row">
                <span className="stat-ico danger"><Plug /></span>
                <div className="grow truncate">
                  <b>{p.label}</b>{" "}
                  <span className="muted">
                    · {p.days_left < 0 ? c("proxyExpired") : c("proxyExpiring").replace("{n}", String(p.days_left))}
                  </span>
                </div>
                <Link href="/admin/proxies" className="btn btn-ghost btn-sm">{c("resolve")}</Link>
              </div>
            ))}
            {alerts.map((a, i) => (
              <div key={i} className="list-row">
                <AlertIcon type={a.type} />
                <div className="grow truncate">
                  <b>{a.company}</b> <span className="muted">· {c(`alert_${a.type}`)}</span>
                </div>
                <Link href="/admin/companies" className="btn btn-ghost btn-sm">{c("resolve")}</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** Prototype KPI: a `.stat` tile wrapped in a link, with a corner arrow. */
function Kpi({
  href,
  label,
  value,
  sub,
  tone = "default",
  icon: Icon,
}: {
  href: string;
  label: string;
  value?: number | string;
  sub?: string;
  tone?: "default" | "positive" | "warning";
  icon: LucideIcon;
}) {
  const icoTone = tone === "positive" ? " success" : tone === "warning" ? " warning" : "";
  return (
    <Link href={href} className="relative block transition hover:-translate-y-px">
      <div className="stat">
        <div className="stat-top">
          <span className={`stat-ico${icoTone}`}><Icon /></span>
          <span className="truncate">{label}</span>
        </div>
        <div className={`stat-value${tone === "positive" ? " pos" : ""}`}>{value ?? "…"}</div>
        {sub && (
          <div className="stat-foot">
            <span className="truncate">{sub}</span>
          </div>
        )}
      </div>
      <ArrowUpRight className="subtle absolute end-3.5 top-3.5 rtl:-scale-x-100" style={{ width: 15, height: 15 }} />
    </Link>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
  tone = "",
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone?: "pos" | "warn" | "";
}) {
  return (
    <div>
      <div className="subtle text-xs row" style={{ gap: 6 }}>
        <Icon style={{ width: 14, height: 14 }} />
        <span className="truncate">{label}</span>
      </div>
      <div className={`stat-value ${tone}`} style={{ fontSize: 20, marginTop: 4 }} dir="ltr">{value}</div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", fontSize: 13.5 }}>
      <span className="row muted" style={{ gap: 8 }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="strong num">{value}</span>
    </div>
  );
}

function AlertIcon({ type }: { type: string }) {
  if (type === "no_proxy") return <span className="stat-ico danger"><Plug /></span>;
  if (type === "no_session") return <span className="stat-ico warning"><Building2 /></span>;
  return <span className="stat-ico warning"><Radio /></span>;
}
