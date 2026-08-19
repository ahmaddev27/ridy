"use client";

import Link from "next/link";
import { latnLocale } from "@/lib/utils";
import { AlertTriangle, Building2, Radio, Plug, ArrowRight, Users, Wallet, TrendingUp, Clock, ReceiptText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AreaChart } from "@/components/charts/area-chart";
import { BarChart } from "@/components/charts/bar-chart";
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
    <div className="space-y-6">
      <PageHeader tkey="adminDashboard" />

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Building2} href="/admin/companies" label={c("companies")} value={s?.companies} sub={`${s?.active_companies ?? 0} ${c("activeShort")}`} />
        <Kpi icon={Users} href="/admin/companies" label={c("drivers")} value={s?.drivers} sub={`${(s?.offers ?? 0).toLocaleString(latnLocale(locale))} ${c("offersTotal")}`} />
        <Kpi icon={Radio} href="/admin/companies" label={c("sessionsActive")} value={s?.sessions_active} tone="positive" />
        <Kpi icon={Wallet} href="/admin/reports" label={c("totalRevenue")} value={billing ? money(billing.totals.total_revenue) : undefined} tone="positive" />
      </div>

      {/* Billing & subscriptions */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <ReceiptText className="h-4 w-4 text-ink" />
          <h3 className="font-semibold text-ink">{c("billingTitle")}</h3>
          <Link href="/admin/reports" className="ms-auto text-ink-subtle transition hover:text-ink">
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* Revenue chart */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-subtle">{c("revenueChart")}</div>
            {revenueChart.length > 0 ? (
              <AreaChart data={revenueChart} color="#10b981" valueFormat={money} />
            ) : (
              <div className="flex h-[180px] items-center justify-center rounded-lg bg-surface-2 text-sm text-ink-subtle">{c("revenueEmpty")}</div>
            )}
          </div>
          {/* Billing mini-stats */}
          <div className="grid grid-cols-2 gap-3 self-start">
            <MiniStat icon={TrendingUp} label={c("monthlyRevenue")} value={billing ? money(thisMonth) : "…"} tone="positive" />
            <MiniStat icon={Wallet} label={c("outstanding")} value={billing ? money(billing.totals.outstanding) : "…"} tone={billing?.totals.outstanding ? "warning" : "default"} />
            <MiniStat icon={ReceiptText} label={c("activeSubs")} value={billing?.totals.active_subscriptions ?? "…"} />
            <MiniStat icon={Clock} label={c("expiringSoon")} value={billing?.totals.expiring_soon ?? "…"} tone={billing?.totals.expiring_soon ? "warning" : "default"} />
          </div>
        </div>
      </Card>

      {/* Offers over time */}
      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-ink">{c("offersChart")}</h3>
        {offersChart.length > 0 ? <BarChart data={offersChart} /> : <div className="h-[180px] animate-pulse rounded-lg bg-surface-2" />}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Session health — donut */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-ink">{c("healthTitle")}</h3>
          <div className="flex items-center gap-6">
            <Donut segments={sessionSegments} total={sessionsTotal} />
            <div className="flex-1 space-y-2.5">
              <LegendRow color={SESSION_COLORS.active} label={c("stActive")} value={breakdown?.active ?? 0} />
              <LegendRow color={SESSION_COLORS.needs_relink} label={c("stNeedsRelink")} value={breakdown?.needs_relink ?? 0} />
              <LegendRow color={SESSION_COLORS.expired} label={c("stExpired")} value={breakdown?.expired ?? 0} />
              <LegendRow color={SESSION_COLORS.no_session} label={c("stNoSession")} value={breakdown?.no_session ?? 0} />
            </div>
          </div>
        </Card>

        {/* Top companies */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-ink">{c("topCompanies")}</h3>
          {top.length === 0 ? (
            <p className="text-sm text-ink-subtle">—</p>
          ) : (
            <div className="space-y-3">
              {top.map((tc) => (
                <div key={tc.company_id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">{tc.company}</span>
                    <span className="tabular-nums text-ink-subtle">{tc.offers.toLocaleString(latnLocale(locale))}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(tc.offers / topMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Alerts */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning-fg" />
          <h3 className="font-semibold text-ink">{c("alerts")}</h3>
        </div>
        {alerts.length === 0 && expiringProxies.length === 0 ? (
          <p className="text-sm text-ink-subtle">{c("noAlerts")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {expiringProxies.map((p) => (
              <li key={`px-${p.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <Plug className="h-4 w-4 text-danger-fg" />
                  <span className="font-medium text-ink">{p.label}</span>
                  <span className="text-ink-subtle">
                    — {p.days_left < 0 ? c("proxyExpired") : c("proxyExpiring").replace("{n}", String(p.days_left))}
                  </span>
                </span>
                <Link href="/admin/proxies" className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2">
                  {c("resolve")}
                </Link>
              </li>
            ))}
            {alerts.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <AlertIcon type={a.type} />
                  <span className="font-medium text-ink">{a.company}</span>
                  <span className="text-ink-subtle">— {c(`alert_${a.type}`)}</span>
                </span>
                <Link href="/admin/companies" className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2">
                  {c("resolve")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

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
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const valueColor = tone === "positive" ? "text-success-fg" : tone === "warning" ? "text-warning-fg" : "text-ink";
  const iconTone =
    tone === "positive" ? "bg-success-bg text-success-fg" : tone === "warning" ? "bg-warning-bg text-warning-fg" : "bg-surface-2 text-ink-muted";
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-line/70 bg-surface p-4 shadow-[0_2px_10px_-2px_rgba(30,34,43,0.06)] transition hover:border-line-strong hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        {Icon && (
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconTone}`}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <ArrowRight className="h-4 w-4 text-ink-subtle transition group-hover:text-ink-muted rtl:rotate-180" />
      </div>
      <div className="mt-3 text-sm text-ink-muted">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${valueColor}`}>{value ?? "…"}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-subtle">{sub}</div>}
    </Link>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  tone?: "default" | "positive" | "warning";
}) {
  const valueColor = tone === "positive" ? "text-success-fg" : tone === "warning" ? "text-warning-fg" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}

function Donut({ segments, total }: { segments: readonly { key: string; value: number; color: string }[]; total: number }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
        <circle cx={50} cy={50} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={12} />
        {total > 0 &&
          segments.map((seg) => {
            const len = (seg.value / total) * C;
            const el = (
              <circle
                key={seg.key}
                cx={50}
                cy={50}
                r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth={12}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums text-ink">{total}</span>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-ink-muted">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

function AlertIcon({ type }: { type: string }) {
  if (type === "no_proxy") return <Plug className="h-4 w-4 text-danger-fg" />;
  if (type === "no_session") return <Building2 className="h-4 w-4 text-ink-subtle" />;
  return <Radio className="h-4 w-4 text-warning-fg" />;
}
