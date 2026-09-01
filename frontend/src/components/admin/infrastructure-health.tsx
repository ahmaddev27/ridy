"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, ListChecks, Clock, Radio, MapPin, Route, RefreshCw, Loader2, RotateCcw, Trash2, AlertTriangle, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { getInfrastructureHealth, getFailedJobs, retryFailedJobs, clearFailedJobs, clearPendingJobs, type InfraStatus, type QueueFailures } from "@/lib/api/admin";

const SERVICE_ICON: Record<string, LucideIcon> = {
  database: Database,
  queue: ListChecks,
  scheduler: Clock,
  reverb: Radio,
  nominatim: MapPin,
  osrm: Route,
};

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
 * external service containers (Reverb, Nominatim, OSRM), plus hands-on queue recovery
 * — retry or clear failed jobs and clear the pending backlog, with the dominant
 * failure and recent errors surfaced so a stalled queue is diagnosable and fixable
 * from the dashboard.
 */
export function InfrastructureHealth() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.systemHealth.${k}`);
  const { data, loading, error, refetch } = useAsync(getInfrastructureHealth, { refetchInterval: 30000 });
  const [failures, setFailures] = useState<QueueFailures | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmKind, setConfirmKind] = useState<null | "flush" | "clearPending">(null);

  // Destructive queue actions confirm through the styled dialog (like the delete
  // confirms elsewhere), never the browser's native confirm().
  const CONFIRMS = {
    flush: { fn: clearFailedJobs, doneKey: "clearedFailed", titleKey: "clearFailed", messageKey: "confirmClearFailed" },
    clearPending: { fn: clearPendingJobs, doneKey: "clearedPending", titleKey: "clearPending", messageKey: "confirmClearPending" },
  } as const;

  const loadFailures = useCallback(async () => {
    try {
      setFailures(await getFailedJobs());
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    loadFailures();
  }, [loadFailures]);

  const act = async (fn: () => Promise<number>, doneKey: string) => {
    setBusy(true);
    try {
      const n = await fn();
      toast.success(c(doneKey).replace("{n}", n.toLocaleString()));
      await Promise.all([refetch(), loadFailures()]);
    } catch {
      toast.error(c("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirmKind) return;
    const cfg = CONFIRMS[confirmKind];
    await act(cfg.fn, cfg.doneKey);
    setConfirmKind(null);
  };

  const failedCount = data?.queue.failed ?? failures?.total ?? 0;
  const pendingCount = data?.queue.pending ?? failures?.pending ?? 0;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">{c("infraTitle")}</h3>
          <p className="mt-0.5 text-xs text-ink-subtle">{c("infraHint")}</p>
        </div>
        <button
          onClick={() => { refetch(); loadFailures(); }}
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
                <Stat label={c("queuePending")} value={pendingCount.toLocaleString()} />
                <Stat label={c("queueFailed")} value={failedCount.toLocaleString()} danger={failedCount > 0} />
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

          {/* Queue recovery actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="me-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{c("queueActions")}</span>
            <ActionButton
              icon={RotateCcw}
              label={`${c("retryFailed")}${failedCount > 0 ? ` (${failedCount.toLocaleString()})` : ""}`}
              onClick={() => act(retryFailedJobs, "retryDone")}
              disabled={busy || failedCount === 0}
            />
            <ActionButton
              icon={Trash2}
              label={c("clearFailed")}
              onClick={() => setConfirmKind("flush")}
              disabled={busy || failedCount === 0}
              danger
            />
            <ActionButton
              icon={Trash2}
              label={c("clearPending")}
              onClick={() => setConfirmKind("clearPending")}
              disabled={busy || pendingCount === 0}
              danger
            />
          </div>

          {/* Failure breakdown + recent errors */}
          {failures && failures.total > 0 && (
            <div className="space-y-3">
              {failures.by_name.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {failures.by_name.map((f) => (
                    <span key={f.name} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <span className="font-medium text-ink">{f.name}</span>
                      <span className="tabular-nums text-ink-subtle">{f.count}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-line bg-surface p-3">
                {failures.jobs.map((j) => (
                  <div key={j.id} className="text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-ink">{j.name}</span>
                      <span className="shrink-0 text-ink-subtle" dir="ltr">{new Date(j.failed_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-0.5 break-words text-danger-fg" dir="ltr">{j.exception}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={confirmKind !== null}
        title={confirmKind ? c(CONFIRMS[confirmKind].titleKey) : ""}
        message={confirmKind ? c(CONFIRMS[confirmKind].messageKey) : ""}
        confirmLabel={c("confirm")}
        cancelLabel={c("cancel")}
        onConfirm={runConfirm}
        onCancel={() => { if (!busy) setConfirmKind(null); }}
        busy={busy}
        danger
      />
    </Card>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled, danger }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-40 " +
        (danger
          ? "border-line text-danger-fg hover:bg-danger-bg"
          : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink")
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
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
