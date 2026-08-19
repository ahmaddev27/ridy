"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Server, Scale, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listShards, updateShard, rebalanceShards, type DaemonShardRow } from "@/lib/api/admin";

export default function ShardsPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.shards.${k}`);
  const { data, loading, error, refetch } = useAsync(listShards, { refetchInterval: 15000 });
  const rows = data ?? [];
  const [busy, setBusy] = useState<number | "rebalance" | null>(null);

  async function toggleActive(row: DaemonShardRow) {
    setBusy(row.id);
    try {
      await updateShard(row.id, { active: !row.active });
      await refetch();
    } catch (e) {
      toast.error(c("actionFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function rebalance() {
    setBusy("rebalance");
    try {
      await rebalanceShards();
      toast.success(c("rebalanced"));
      await refetch();
    } catch (e) {
      toast.error(c("actionFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  const totalCompanies = rows.reduce((n, r) => n + r.companies, 0);
  const liveCount = rows.filter((r) => r.live).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={c("title")}
        subtitle={c("subtitle")}
        action={
          <Button onClick={rebalance} disabled={busy === "rebalance" || liveCount < 2}>
            {busy === "rebalance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
            {c("rebalance")}
          </Button>
        }
      />

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label={c("statShards")} value={String(rows.length)} />
          <Stat label={c("statLive")} value={String(liveCount)} />
          <Stat label={c("statCompanies")} value={totalCompanies.toLocaleString(locale)} />
        </div>
      )}

      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : error && rows.length === 0 ? (
          <EmptyState icon={Server} title={c("loadError")} description={error} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Server} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colShard")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colCompanies")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colLastSeen")}</th>
                  <th className="px-4 py-3 font-semibold text-end">{c("colAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const tone: Status = !r.active ? "neutral" : r.live ? "connected" : "expiring";
                  const label = !r.active ? c("stDrained") : r.live ? c("stLive") : c("stIdle");
                  return (
                    <tr key={r.id} className="hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <div className="font-mono font-medium text-ink">{r.name}</div>
                        {r.label && <div className="text-xs text-ink-subtle">{r.label}</div>}
                      </td>
                      <td className="px-4 py-3"><Badge status={tone}>{label}</Badge></td>
                      <td className="px-4 py-3 font-medium text-ink">{r.companies.toLocaleString(locale)}</td>
                      <td className="px-4 py-3 text-ink-muted">
                        {r.last_seen_at ? new Date(r.last_seen_at).toLocaleString(locale) : "—"}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <Button variant="secondary" size="sm" onClick={() => toggleActive(r)} disabled={busy === r.id}>
                          {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : r.active ? c("drain") : c("enable")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-ink-subtle">{c("hint")}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
    </Card>
  );
}
