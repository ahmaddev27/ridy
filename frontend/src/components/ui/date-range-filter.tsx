"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { fleetYmd, shiftYmd } from "@/lib/fleet-day";

/** A quick-range preset. Bounds are inclusive local calendar days. */
type Preset = "today" | "yesterday" | "week" | "month";

interface Props {
  /** Current bounds as local YYYY-MM-DD strings ("" = no date filter). */
  from: string;
  to: string;
  /** Notified with the new inclusive-day bounds ("" , "" clears the filter). */
  onChange: (from: string, to: string) => void;
  /** Presets follow the 04:00 Europe/Berlin fleet-day (offer data) instead of
   *  the browser's calendar day — so "Today" isn't empty between 00:00 and 04:00. */
  fleetDays?: boolean;
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
export function DateRangeFilter({ from, to, onChange, fleetDays = false, className = "" }: Props) {
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
  const activePreset = useMemo(() => matchPreset(from, to, fleetDays), [from, to, fleetDays]);

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
    const [f, e] = presetBounds(p, fleetDays);
    onChange(f, e);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={`row ${className}`} style={{ gap: 4, position: "relative" }}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={!hasRange}
        aria-label={c("previousPeriod")}
        className="btn btn-secondary btn-sm btn-icon"
      >
        <ChevronLeft className="rtl:rotate-180" />
      </button>

      <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-secondary btn-sm" aria-haspopup="true" aria-expanded={open}>
        <Calendar />
        <span className="num">{label}</span>
        <ChevronDown />
      </button>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={!hasRange}
        aria-label={c("nextPeriod")}
        className="btn btn-secondary btn-sm btn-icon"
      >
        <ChevronRight className="rtl:rotate-180" />
      </button>

      {open && (
        <div className="menu" style={{ top: "calc(100% + 6px)", insetInlineStart: 0, padding: 6, width: 250 }}>
          <div className="g-2" style={{ gap: 6 }}>
            {(["today", "yesterday", "week", "month"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`btn btn-sm ${activePreset === p ? "btn-primary" : "btn-secondary"}`}
                style={{ justifyContent: "center", width: "auto" }}
              >
                {c(p === "today" ? "presetToday" : p === "yesterday" ? "presetYesterday" : p === "week" ? "presetWeek" : "presetMonth")}
              </button>
            ))}
          </div>

          <div className="g-2" style={{ gap: 8, paddingTop: 12 }}>
            <div className="field">
              <label>{c("dateFrom")}</label>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => onChange(e.target.value, to || e.target.value)}
                className="input input-sm"
              />
            </div>
            <div className="field">
              <label>{c("dateTo")}</label>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => onChange(from || e.target.value, e.target.value)}
                className="input input-sm"
              />
            </div>
          </div>

          {hasRange && (
            <button
              type="button"
              onClick={() => {
                onChange("", "");
                setOpen(false);
              }}
              style={{ marginTop: 8, justifyContent: "center", color: "var(--primary)" }}
            >
              {c("clearDates")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const PRESET_SPAN: Record<Preset, { days: number; offset: number }> = {
  today: { days: 1, offset: 0 },
  yesterday: { days: 1, offset: 1 },
  week: { days: 7, offset: 0 },
  month: { days: 30, offset: 0 },
};

/** Inclusive [from, to] day bounds for a preset (fleet-days or local calendar days). */
function presetBounds(p: Preset, fleetDays: boolean): [string, string] {
  if (fleetDays) {
    const { days, offset } = PRESET_SPAN[p];
    const end = shiftYmd(fleetYmd(), -offset);
    return [shiftYmd(end, -(days - 1)), end];
  }
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
function matchPreset(from: string, to: string, fleetDays: boolean): Preset | null {
  if (!from || !to) return null;
  for (const p of ["today", "yesterday", "week", "month"] as const) {
    const [f, e] = presetBounds(p, fleetDays);
    if (f === from && e === to) return p;
  }
  return null;
}
