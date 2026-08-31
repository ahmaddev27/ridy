"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";

/** A quick-range preset. Bounds are inclusive local calendar days. */
type Preset = "today" | "yesterday" | "week" | "month";

interface Props {
  /** Current bounds as local YYYY-MM-DD strings ("" = no date filter). */
  from: string;
  to: string;
  /** Notified with the new inclusive-day bounds ("" , "" clears the filter). */
  onChange: (from: string, to: string) => void;
  className?: string;
}

/** Local YYYY-MM-DD (no time-zone drift from toISOString). */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Parse a YYYY-MM-DD into a local Date at midnight. */
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * The Uber-style date-range navigator used across every dashboard list: a
 * centered pill showing the active range ("24. Aug. – 31. Aug.") that opens a
 * preset/custom menu, flanked by ‹ › arrows that step the window by its own
 * length. Purely controlled — it owns no range state, so it drops into any
 * page's filter row and stays in sync with that page's query.
 */
export function DateRangeFilter({ from, to, onChange, className = "" }: Props) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`common.${k}`);
  const loc = latnLocale(locale);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the menu on any outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasRange = Boolean(from && to);
  const activePreset = useMemo(() => matchPreset(from, to), [from, to]);

  // Pill label: "24. Aug. – 31. Aug." (or a single day, or "All dates").
  const label = useMemo(() => {
    if (!hasRange) return c("allDates");
    const fmt = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" });
    const a = fmt.format(parse(from));
    const b = fmt.format(parse(to));
    return a === b ? a : `${a} – ${b}`;
  }, [from, to, hasRange, loc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ‹ › step the window backward/forward by its own length (Uber behaviour).
  const step = (dir: -1 | 1) => {
    if (!hasRange) return;
    const start = parse(from);
    const end = parse(to);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    start.setDate(start.getDate() + dir * days);
    end.setDate(end.getDate() + dir * days);
    onChange(ymd(start), ymd(end));
  };

  const applyPreset = (p: Preset) => {
    const [f, e] = presetBounds(p);
    onChange(f, e);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={`relative inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={!hasRange}
        aria-label={c("dateFrom")}
        className="rounded-full p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-surface-2"
      >
        <Calendar className="h-3.5 w-3.5 text-ink-subtle" />
        <span className="tabular-nums">{label}</span>
        <ChevronDown className={`h-4 w-4 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={!hasRange}
        aria-label={c("dateTo")}
        className="rounded-full p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute top-full z-20 mt-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg ltr:left-0 rtl:right-0">
          {/* Presets */}
          <div className="grid grid-cols-2 gap-1.5">
            {(["today", "yesterday", "week", "month"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activePreset === p ? "bg-primary text-primary-ink" : "bg-surface-2 text-ink-muted hover:text-ink"
                }`}
              >
                {c(p === "today" ? "presetToday" : p === "yesterday" ? "presetYesterday" : p === "week" ? "presetWeek" : "presetMonth")}
              </button>
            ))}
          </div>

          {/* Custom range */}
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <label className="flex items-center justify-between gap-2 text-xs text-ink-muted">
              <span>{c("dateFrom")}</span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => onChange(e.target.value, to || e.target.value)}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-ink"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-ink-muted">
              <span>{c("dateTo")}</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => onChange(from || e.target.value, e.target.value)}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-ink"
              />
            </label>
          </div>

          {hasRange && (
            <button
              type="button"
              onClick={() => {
                onChange("", "");
                setOpen(false);
              }}
              className="mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-primary hover:bg-surface-2"
            >
              {c("clearDates")}
            </button>
          )}
        </div>
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

/** Which preset (if any) the given bounds correspond to, for chip highlighting. */
function matchPreset(from: string, to: string): Preset | null {
  if (!from || !to) return null;
  for (const p of ["today", "yesterday", "week", "month"] as const) {
    const [f, e] = presetBounds(p);
    if (f === from && e === to) return p;
  }
  return null;
}
