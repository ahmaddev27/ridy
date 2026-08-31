"use client";

import { useState } from "react";
import { Cpu, MemoryStick, HardDrive, Network, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";
import { getSystemMetrics, type SystemMetrics } from "@/lib/api/admin";

/** Human-readable bytes (binary units). */
function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Usage-percentage → semantic bar colour (calm under 70, warn, then critical). */
function tone(pct: number | null): string {
  if (pct === null) return "bg-ink-subtle";
  if (pct >= 90) return "bg-danger-fg";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

/**
 * Super-admin "Server resources" panel: the host's live CPU / RAM / disk /
 * network, fetched on demand via a refresh button (never polled) so the
 * two-sample rate reads on the server run only when explicitly requested.
 */
export function ServerResources() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.systemHealth.${k}`);
  const [data, setData] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setData(await getSystemMetrics());
    } catch {
      toast.error(c("metricsFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">{c("resourcesTitle")}</h3>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {data ? c("sampledAt").replace("{time}", new Date(data.sampled_at).toLocaleTimeString()) : c("resourcesHint")}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {c("refresh")}
        </button>
      </div>

      {data === null ? (
        <div className="rounded-lg border border-dashed border-line py-8 text-center text-sm text-ink-subtle">
          {c("resourcesEmpty")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={Cpu}
            label={c("cpu")}
            percent={data.cpu.usage_percent}
            detail={
              data.cpu.load
                ? `${c("load")}: ${data.cpu.load.map((l) => l.toFixed(2)).join(" · ")} · ${data.cpu.cores} ${c("cores")}`
                : `${data.cpu.cores} ${c("cores")}`
            }
          />
          <Metric
            icon={MemoryStick}
            label={c("ram")}
            percent={data.memory.used_percent}
            detail={`${fmtBytes(data.memory.used_bytes)} / ${fmtBytes(data.memory.total_bytes)}`}
          />
          <Metric
            icon={HardDrive}
            label={c("disk")}
            percent={data.disk.used_percent}
            detail={`${fmtBytes(data.disk.used_bytes)} / ${fmtBytes(data.disk.total_bytes)} · ${fmtBytes(data.disk.free_bytes)} ${c("free")}`}
          />
          <Metric
            icon={Network}
            label={c("network")}
            detail={`↓ ${fmtBytes(data.network.rx_bytes_per_sec)}/s · ↑ ${fmtBytes(data.network.tx_bytes_per_sec)}/s`}
          />
        </div>
      )}
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  percent,
  detail,
}: {
  icon: typeof Cpu;
  label: string;
  percent?: number | null;
  detail: string;
}) {
  const pct = percent ?? null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-ink-muted">
        <Icon className="h-4 w-4 text-ink-subtle" />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      {pct !== null ? (
        <>
          <div className="mt-2 text-2xl font-bold tabular-nums text-ink">{pct}%</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full transition-all ${tone(pct)}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
          </div>
        </>
      ) : (
        <div className="mt-2 text-lg font-semibold text-ink">{detail.split(" · ")[0]}</div>
      )}
      <p className="mt-2 truncate text-xs text-ink-subtle" title={detail}>
        {detail}
      </p>
    </div>
  );
}
