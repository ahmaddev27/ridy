/**
 * Calendar arithmetic for the note pickers. Pure, so it can be tested without
 * a renderer — the same split as `note-rules.ts` and `receipt-steps.ts`.
 *
 * Two product rules are enforced here rather than in the component:
 *
 * - **The week starts on Monday.** It does everywhere else in this product
 *   (fleet weeks, stats windows), and `Date.getDay()` is Sunday-based, so the
 *   shift has to happen somewhere. It happens once, here.
 * - **Latin digits.** Every number this file produces is built with `padStart`,
 *   never through a locale-aware formatter. `Intl` under an `ar` locale renders
 *   Arabic-Indic digits, and a driver reading ٠٨:٣٠ on a German timesheet is
 *   exactly what the rule exists to prevent. Month and weekday NAMES are
 *   translated — they are words; the numbers are not.
 */

export const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * `YYYY-MM-DD` for a LOCAL date.
 *
 * Never `toISOString()`: it converts to UTC first, so a note written at 01:00
 * in Berlin would be dated the previous day. The API's `start_date` is a
 * calendar day, not an instant.
 */
export function toDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today as `YYYY-MM-DD`, local. */
export function todayValue(now: Date = new Date()): string {
  return toDateValue(now);
}

/**
 * Parse `YYYY-MM-DD`. Anything else — blank, malformed, or a real date that
 * does not exist like 2026-02-31 — falls back to `fallback`, so a value that
 * somehow got stored cannot crash the picker or silently roll over a month.
 */
export function fromDateValue(value: string, fallback: Date = new Date()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return fallback;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(y, mo - 1, d);
  // `new Date(2026, 1, 31)` silently becomes 3 March; reject it rather than
  // showing the driver a different day than the one stored.
  const exact = parsed.getFullYear() === y && parsed.getMonth() === mo - 1 && parsed.getDate() === d;
  return exact ? parsed : fallback;
}

/**
 * The cells of a month grid, Monday-first, padded with nulls so the row of
 * weekday labels stays aligned and the length is always a multiple of 7.
 */
export function monthGrid(year: number, month: number): (number | null)[] {
  // getDay() is Sunday-based (0 = Sunday); shift so Monday is 0.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** `HH:MM` from a 24h hour and minute, or `''` when there is no hour. */
export function toTimeValue(hour: number | null, minute: number | null): string {
  return hour === null ? "" : `${pad(hour)}:${pad(minute ?? 0)}`;
}

/** `{hour, minute}` from `HH:MM`, or nulls when it is not a valid 24h time. */
export function fromTimeValue(value: string): { hour: number | null; minute: number | null } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : { hour: null, minute: null };
}

/**
 * Split a comma-separated dictionary value into exactly `expected` names, or
 * `[]` when a translation is missing or miscounted — the caller then falls back
 * rather than rendering `undefined` in the header of a calendar.
 */
export function splitNames(raw: string, expected: number): string[] {
  const list = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  return list.length === expected ? list : [];
}
