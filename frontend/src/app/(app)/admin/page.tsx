"use client";

import Link from "next/link";
import { AlertTriangle, Building2, Radio, Plug, ArrowRight } from "lucide-react";
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
  const breakdown = data?.session_breakdown;
  const chart = (data?.offers_daily ?? []).map((d) => ({
    label: new Date(d.date).toLocaleDateString(locale, { month: "numeric", day: "numeric" }),
    value: d.count,
  }));
  const top = data?.top_companies ?? [];
  const topMax = Math.max(1, ...top.map((t) => t.offers));

  return (
    <div className="space-y-6">
      <PageHeader tkey="adminDashboard" />

      {/* Clickable KPI cards → their pages */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi href="/admin/companies" label={c("companies")} value={s?.companies} sub={`${s?.active_companies ?? 0} ${c("activeShort")}`} />
        <Kpi href="/admin/companies" label={c("sessionsActive")} value={s?.sessions_active} tone="positive" />
        <Kpi
          href="/admin/companies"
          label={c("sessionsAttention")}
          value={s?.sessions_need_attention}
          tone={s && s.sessions_need_attention > 0 ? "warning" : "default"}
        />
        <Kpi href="/admin/companies" label={c("drivers")} value={s?.drivers} sub={`${s?.offers ?? 0} ${c("offers")}`} />
      </div>

      {/* Offers over time */}
      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-slate-800">{c("offersChart")}</h3>
        {chart.length > 0 ? <AreaChart data={chart} /> : <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Session breakdown */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-slate-800">{c("sessionBreakdown")}</h3>
          <div className="space-y-3">
            <Bar label={c("stActive")} value={breakdown?.active ?? 0} total={sessionsTotal(breakdown)} color="#059669" />
            <Bar label={c("stNeedsRelink")} value={breakdown?.needs_relink ?? 0} total={sessionsTotal(breakdown)} color="#d97706" />
            <Bar label={c("stExpired")} value={breakdown?.expired ?? 0} total={sessionsTotal(breakdown)} color="#e11d48" />
            <Bar label={c("stNoSession")} value={breakdown?.no_session ?? 0} total={sessionsTotal(breakdown)} color="#94a3b8" />
          </div>
        </Card>

        {/* Top companies */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-slate-800">{c("topCompanies")}</h3>
          {top.length === 0 ? (
            <p className="text-sm text-slate-400">—</p>
          ) : (
            <div className="space-y-3">
              {top.map((tc) => (
                <div key={tc.company_id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{tc.company}</span>
                    <span className="text-slate-400">{tc.offers}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-900" style={{ width: `${(tc.offers / topMax) * 100}%` }} />
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
          <h3 className="font-semibold text-slate-800">{c("alerts")}</h3>
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-400">{c("noAlerts")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <AlertIcon type={a.type} />
                  <span className="font-medium text-slate-800">{a.company}</span>
                  <span className="text-slate-400">— {c(`alert_${a.type}`)}</span>
                </span>
                <Link href="/admin/companies" className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-900 hover:bg-slate-100">
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
}: {
  href: string;
  label: string;
  value?: number;
  sub?: string;
  tone?: "default" | "positive" | "warning";
}) {
  const valueColor =
    tone === "positive" ? "text-emerald-600" : tone === "warning" ? "text-amber-600" : "text-slate-900";
  return (
    <Link
      href={href}
      className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-400 hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-slate-500 rtl:rotate-180" />
      </div>
      <div className={`mt-1 text-2xl font-bold ${valueColor}`}>{value ?? "…"}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </Link>
  );
}

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-slate-600">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="font-medium text-slate-700">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${(value / total) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function AlertIcon({ type }: { type: string }) {
  if (type === "no_proxy") return <Plug className="h-4 w-4 text-rose-500" />;
  if (type === "no_session") return <Building2 className="h-4 w-4 text-slate-400" />;
  return <Radio className="h-4 w-4 text-amber-500" />;
}
