// The fleet/business day follows Uber: it starts at 04:00 Europe/Berlin, not
// midnight, so a trip at 02:30 belongs to the PREVIOUS calendar day's fleet-day.
// Everything here is computed on Berlin wall-clock time (not the browser's zone)
// so the dashboard's date filters and day grouping match the backend
// (App\Support\FleetDay) and the mobile app for every viewer.

export const FLEET_DAY_START_HOUR = 4;
export const FLEET_TIME_ZONE = "Europe/Berlin";

const DAY_MS = 86_400_000;

const berlinFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: FLEET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Berlin wall-clock calendar date (UTC-midnight ms) and hour for a moment. */
function berlinDateAndHour(ref: Date): { dateMs: number; hour: number } {
  const parts: Record<string, number> = {};
  for (const p of berlinFormatter.formatToParts(ref)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return { dateMs: Date.UTC(parts.year, parts.month - 1, parts.day), hour: parts.hour % 24 };
}

function ymdFromUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD of the fleet-day a moment belongs to (now by default). */
export function fleetYmd(ref: Date = new Date()): string {
  const { dateMs, hour } = berlinDateAndHour(ref);
  return ymdFromUtcMs(hour < FLEET_DAY_START_HOUR ? dateMs - DAY_MS : dateMs);
}

/** Fleet-day key (YYYY-MM-DD) for an ISO timestamp — used to group offers by day. */
export function fleetDayKey(iso: string): string {
  return fleetYmd(new Date(iso));
}

/** Shift a YYYY-MM-DD label by whole days (calendar arithmetic, DST-proof). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return ymdFromUtcMs(Date.UTC(y, m - 1, d) + days * DAY_MS);
}

/**
 * Inclusive fleet-day [from, to] labels for "the last N fleet-days" ending
 * today (N = 1 → today only), or yesterday only when `offset` is 1 and N = 1.
 * The backend treats `to` as inclusive (FleetDay::endOfDate = next day 04:00),
 * so these are labels, never exclusive instants.
 */
export function fleetDayRange(days: number, offset = 0, ref: Date = new Date()): { from: string; to: string } {
  const to = shiftYmd(fleetYmd(ref), -offset);
  return { from: shiftYmd(to, -(Math.max(1, days) - 1)), to };
}

/** Format a YYYY-MM-DD label for display without any time-zone drift. */
export function formatYmd(ymd: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
