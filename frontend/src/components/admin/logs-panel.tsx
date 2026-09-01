"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Loader2, Trash2, Search, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { getLogs, clearLogs, type LogSource } from "@/lib/api/admin";

/** Tone a log line by its level word (ERROR red, WARNING amber, else muted). */
function lineTone(line: string): string {
  if (/\b(ERROR|CRITICAL|EMERGENCY|ALERT|Exception|Fatal)\b/i.test(line)) return "text-danger-fg";
  if (/\b(WARNING|WARN)\b/i.test(line)) return "text-amber-500";
  if (/\b(INFO|NOTICE)\b/i.test(line)) return "text-emerald-600";
  return "text-ink-muted";
}

export function LogsPanel() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.systemHealth.${k}`);
  const [source, setSource] = useState<LogSource>("backend");
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLogs(source, 500);
      setLines(res.lines);
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, [source]);

  // Load on source change, then poll every 15s while the tab is open.
  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  // Auto-scroll to the newest line after each load (unless the admin turned it off).
  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, autoScroll]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? lines.filter((l) => l.toLowerCase().includes(f)) : lines;
  }, [lines, filter]);

  const clear = async () => {
    setBusy(true);
    try {
      await clearLogs(source);
      setLines([]);
      toast.success(c("logCleared"));
    } catch {
      toast.error(c("actionFailed"));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{c("logsTitle")}</h3>
          <p className="mt-0.5 text-xs text-ink-subtle">{c("logsHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {c("refresh")}
          </button>
          <button
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-danger-fg transition hover:bg-danger-bg"
          >
            <Trash2 className="h-4 w-4" />
            {c("logClear")}
          </button>
        </div>
      </div>

      {/* Source toggle + filter + auto-scroll */}
      <div className="flex flex-wrap items-center gap-2">
        {(["backend", "frontend"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
              (source === s ? "bg-primary text-primary-ink" : "border border-line text-ink-muted hover:bg-surface-2")
            }
          >
            {c(`log_${s}`)}
          </button>
        ))}
        <div className="relative ms-auto min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-ink-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={c("logFilter")}
            className="w-full rounded-lg border border-line bg-surface py-2 ps-9 pe-3 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-primary"
          />
        </div>
        <button
          onClick={() => setAutoScroll((v) => !v)}
          title={c("logAutoscroll")}
          className={
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition " +
            (autoScroll ? "border-primary text-primary" : "border-line text-ink-subtle hover:bg-surface-2")
          }
        >
          <ArrowDownToLine className="h-4 w-4" />
        </button>
      </div>

      {/* Log body */}
      <div
        ref={boxRef}
        dir="ltr"
        className="h-[52vh] overflow-auto rounded-xl border border-line bg-[#0b0d0e] p-3 font-mono text-xs leading-relaxed"
      >
        {shown.length === 0 ? (
          <div className="grid h-full place-items-center text-ink-subtle">{c("logEmpty")}</div>
        ) : (
          shown.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap break-words ${lineTone(l)}`}>
              {l}
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        open={confirming}
        title={c("logClear")}
        message={c("confirmLogClear")}
        confirmLabel={c("confirm")}
        cancelLabel={c("cancel")}
        onConfirm={clear}
        onCancel={() => { if (!busy) setConfirming(false); }}
        busy={busy}
        danger
      />
    </Card>
  );
}
