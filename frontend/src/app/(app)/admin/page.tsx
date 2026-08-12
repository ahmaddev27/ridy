"use client";

import Link from "next/link";
import { latnLocale } from "@/lib/utils";
import { AlertTriangle, Building2, Radio, Plug, ArrowRight, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AreaChart } from "@/components/charts/area-chart";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getOverview } from "@/lib/api/admin";

export default function AdminDashboardPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.adminDashboard.${k}`);
  const { data } = useAsync(getOverview, { refetchInterval: 20000 });

  const s = data?.stats;
  const alerts = data?.alerts ?? [];
  const expiringProxies = data?.expiring_proxies ?? [];
  const breakdown = data?.session_breakdown;
  const chart = (data?.offers_daily ?? []).map((d) => ({
    label: new Date(d.date).toLocaleDateString(latnLocale(locale), { month: "numeric", day: "numeric" }),
    value: d.count,
  }));
  const top = data?.top_companies ?? [];
  const topMax = Math.max(1, ...top.map((t) => t.offers));

  return (
    <div className="space-y-6">
      <PageHeader tkey="adminDashboard" />

      {/* Clickable KPI cards → their pages */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Building2} href="/admin/companies" label={c("companies")} value={s?.companies} sub={`${s?.active_companies ?? 0} ${c("activeShort")}`} />
        <Kpi icon={Radio} href="/admin/companies" label={c("sessionsActive")} value={s?.sessions_active} tone="positive" />
        <Kpi
          icon={AlertTriangle}
          href="/admin/companies"
          label={c("sessionsAttention")}
          value={s?.sessions_need_attention}
          tone={s && s.sessions_need_attention > 0 ? "warning" : "default"}
        />
        <Kpi icon={Users} href="/admin/companies" label={c("drivers")} value={s?.drivers} sub={`${s?.offers ?? 0} ${c("offers")}`} />
      </div>

      {/* Offers over time */}
      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-ink">{c("offersChart")}</h3>
        {chart.length > 0 ? <AreaChart data={chart} /> : <div className="h-[180px] animate-pulse rounded-lg bg-surface-2" />}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Session breakdown */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-ink">{c("sessionBreakdown")}</h3>
          <div className="space-y-3">
            <Bar label={c("stActive")} value={breakdown?.active ?? 0} total={sessionsTotal(breakdown)} color="#059669" />
            <Bar label={c("stNeedsRelink")} value={breakdown?.needs_relink ?? 0} total={sessionsTotal(breakdown)} color="#d97706" />
            <Bar label={c("stExpired")} value={breakdown?.expired ?? 0} total={sessionsTotal(breakdown)} color="#e11d48" />
            <Bar label={c("stNoSession")} value={breakdown?.no_session ?? 0} total={sessionsTotal(breakdown)} color="#94a3b8" />
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
                    <span className="text-ink-subtle">{tc.offers}</span>
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
          <AlertTriangle className="h-4 w-4 text-amber-500" />
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

function sessionsTotal(b?: { active: number; expired: number; needs_relink: number; no_session: number }): number {
  if (!b) return 1;
  return Math.max(1, b.active + b.expired + b.needs_relink + b.no_session);
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
  value?: number;
  sub?: string;
  tone?: "default" | "positive" | "warning";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const valueColor =
    tone === "positive" ? "text-success-fg" : tone === "warning" ? "text-warning-fg" : "text-ink";
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

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-ink-muted">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="font-medium text-ink">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${(value / total) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function AlertIcon({ type }: { type: string }) {
  if (type === "no_proxy") return <Plug className="h-4 w-4 text-danger-fg" />;
  if (type === "no_session") return <Building2 className="h-4 w-4 text-ink-subtle" />;
  return <Radio className="h-4 w-4 text-amber-500" />;
}
