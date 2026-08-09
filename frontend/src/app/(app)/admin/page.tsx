"use client";

import { AlertTriangle, Building2, Radio, Plug } from "lucide-react";
import Link from "next/link";
import { Card, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getOverview } from "@/lib/api/admin";

export default function AdminDashboardPage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.adminDashboard.${k}`);
  const { data, loading } = useAsync(getOverview, { refetchInterval: 20000 });

  const stats = data?.stats;
  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader tkey="adminDashboard" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={c("companies")} value={stats?.companies ?? (loading ? "…" : 0)} />
        <StatCard label={c("activeCompanies")} value={stats?.active_companies ?? (loading ? "…" : 0)} tone="positive" />
        <StatCard label={c("sessionsActive")} value={stats?.sessions_active ?? (loading ? "…" : 0)} tone="positive" />
        <StatCard
          label={c("sessionsAttention")}
          value={stats?.sessions_need_attention ?? (loading ? "…" : 0)}
          tone={stats && stats.sessions_need_attention > 0 ? "warning" : "default"}
        />
        <StatCard label={c("drivers")} value={stats?.drivers ?? (loading ? "…" : 0)} />
        <StatCard label={c("offers")} value={stats?.offers ?? (loading ? "…" : 0)} />
      </div>

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
                  <Icon type={a.type} />
                  <span className="font-medium text-slate-800">{a.company}</span>
                  <span className="text-slate-400">— {c(`alert_${a.type}`)}</span>
                </span>
                <Link
                  href="/admin/companies"
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                >
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

function Icon({ type }: { type: string }) {
  if (type === "no_proxy") return <Plug className="h-4 w-4 text-rose-500" />;
  if (type === "no_session") return <Building2 className="h-4 w-4 text-slate-400" />;
  return <Radio className="h-4 w-4 text-amber-500" />;
}
