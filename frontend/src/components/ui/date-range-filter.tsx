"use client";

import { useI18n } from "@/lib/i18n/context";

/** A quick-range preset. Bounds are computed as inclusive local calendar days. */
type Preset = "today" | "yesterday" | "week" | "month";

interface Props {
  /** Current bounds as local YYYY-MM-DD strings ("" when unset). */
  from: string;
  to: string;
  /** Notified with the new inclusive-day bounds whenever either end changes. */
  onChange: (from: string, to: string) => void;
  className?: string;
}

/** Local YYYY-MM-DD (no time-zone drift from toISOString). */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The one date-range filter used across every dashboard list: Today / Yesterday
 * / Week / Month preset chips plus two native date inputs, all sharing one look.
 * Purely controlled — it owns no state, so it composes into any page's filter row.
 */
export function DateRangeFilter({ from, to, onChange, className = "" }: Props) {
  const { t } = useI18n();
  const c = (k: string) => t(`common.${k}`);

  // Which preset (if any) the current bounds correspond to, so its chip lights up.
  const activePreset = ((): Preset | null => {
    if (!from || !to) return null;
    for (const p of ["today", "yesterday", "week", "month"] as const) {
      const [f, e] = presetBounds(p);
      if (f === from && e === to) return p;
    }
    return null;
  })();

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
        {(["today", "yesterday", "week", "month"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(...presetBounds(p))}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activePreset === p
                ? "bg-primary text-primary-ink"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {c(p === "today" ? "presetToday" : p === "yesterday" ? "presetYesterday" : p === "week" ? "presetWeek" : "presetMonth")}
          </button>
        ))}
      </div>

      <input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        title={c("dateFrom")}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-line"
      />
      <span className="text-ink-subtle">–</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        title={c("dateTo")}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-line"
      />

      {(from || to) && (
        <button type="button" onClick={() => onChange("", "")} className="text-xs font-medium text-primary hover:underline">
          {c("clearDates")}
        </button>
      )}
    </div>
  );
}

/** Inclusive [from, to] local-day bounds for a preset. */
function presetBounds(p: Preset): [string, string] {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (p === "yesterday") {
    start.setDate(now.getDate() - 1);
    end.setDate(now.getDate() - 1);
  } else if (p === "week") {
    start.setDate(now.getDate() - 6);
  } else if (p === "month") {
    start.setDate(now.getDate() - 29);
  }
  return [ymd(start), ymd(end)];
}
