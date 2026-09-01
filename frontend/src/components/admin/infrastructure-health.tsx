"use client";

import { Database, ListChecks, Clock, Radio, MapPin, Route, RefreshCw, Loader2, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getInfrastructureHealth, type InfraStatus } from "@/lib/api/admin";

/** Icon per known service key (falls back to a generic node). */
const SERVICE_ICON: Record<string, LucideIcon> = {
  database: Database,
  queue: ListChecks,
  scheduler: Clock,
  reverb: Radio,
  nominatim: MapPin,
  osrm: Route,
};

/** status → dot + text colour (calm green / amber / red). */
const STATUS_TONE: Record<InfraStatus, { dot: string; text: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-600" },
  warn: { dot: "bg-amber-500", text: "text-amber-600" },
  down: { dot: "bg-danger-fg", text: "text-danger-fg" },
};

/** "3m 12s" / "45s" — a compact age. */
function ageLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m < 60 ? `${m}m ${s}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Super-admin "System services" panel: live health of the queue, scheduler and the
 * external service containers (Reverb, Nominatim, OSRM). Polls every 30s (each probe
 * is time-boxed on the server) so a crash-looping worker or a stalled queue surfaces
 * on its own — the exact failure that used to leave offers ungeocoded.
 */
export function InfrastructureHealth() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.systemHealth.${k}`);
  const { data, loading, error, refetch } = useAsync(getInfrastructureHealth, { refetchInterval: 30000 });

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">{c("infraTitle")}</h3>
          <p className="mt-0.5 text-xs text-ink-subtle">{c("infraHint")}</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {c("refresh")}
        </button>
      </div>

      {data === null ? (
        <div className="rounded-lg border border-dashed border-line py-8 text-center text-sm text-ink-subtle">
          {error ?? c("resourcesEmpty")}
        </div>
      ) : (
        <>
          {/* Service status grid */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.services.map((s) => {
              const Icon = SERVICE_ICON[s.key] ?? Radio;
              const tone = STATUS_TONE[s.status];
              return (
                <div key={s.key} className="flex items-center justify-between rounded-xl border border-line bg-surface p-3.5">
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 text-ink-subtle" />
                    <span className="text-sm font-medium text-ink">{c(`svc_${s.key}`)}</span>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${tone.text}`}>
                    <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                    {c(`st_${s.status}`)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Queue + scheduler detail */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-ink-muted">
                <ListChecks className="h-4 w-4 text-ink-subtle" />
                <span className="text-xs font-semibold uppercase tracking-wide">{c("svc_queue")}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <Stat label={c("queuePending")} value={data.queue.pending.toLocaleString()} />
                <Stat label={c("queueFailed")} value={data.queue.failed.toLocaleString()} danger={data.queue.failed > 0} />
                <Stat label={c("queueOldest")} value={ageLabel(data.queue.oldest_pending_seconds)} />
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-ink-muted">
                <Clock className="h-4 w-4 text-ink-subtle" />
                <span className="text-xs font-semibold uppercase tracking-wide">{c("svc_scheduler")}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <Stat label={c("schedulerLastTick")} value={ageLabel(data.scheduler.seconds_since)} danger={data.scheduler.status === "down"} />
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <span className="text-xs text-ink-subtle">{label}</span>
      <div className={`font-semibold tabular-nums ${danger ? "text-danger-fg" : "text-ink"}`}>{value}</div>
    </div>
  );
}
