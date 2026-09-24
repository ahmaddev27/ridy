// The fleet/business day follows Uber: it starts at 04:00 Europe/Berlin, not
// midnight. So a trip at 02:30 belongs to the PREVIOUS calendar day's fleet-day.
// This mirrors the backend's wall-clock rule (App\Support\FleetDay): take the
// Berlin wall-clock date, step back one day before 04:00. Subtracting 4 hours of
// ELAPSED time instead was off by an hour on DST days, and device-local time
// was wrong on phones not set to German time.

export const FLEET_DAY_START_HOUR = 4;

const FLEET_TZ = "Europe/Berlin";

let berlinParts: Intl.DateTimeFormat | null | undefined;

/** Year/month/day/hour of `ref` on the Berlin wall clock (device-local fallback). */
function berlinWallClock(ref: Date): { y: number; m: number; d: number; h: number } {
  if (berlinParts === undefined) {
    try {
      berlinParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: FLEET_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      berlinParts = null; // engine without time-zone data: use device time
    }
  }
  if (berlinParts) {
    const parts: Record<string, number> = {};
    for (const p of berlinParts.formatToParts(ref)) {
      if (p.type !== "literal") parts[p.type] = Number(p.value);
    }
    if (parts.year && parts.month && parts.day && Number.isFinite(parts.hour)) {
      return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour % 24 };
    }
  }
  return { y: ref.getFullYear(), m: ref.getMonth() + 1, d: ref.getDate(), h: ref.getHours() };
}

/**
 * The fleet-day `ref` belongs to, as a LOCAL-NOON anchor on that calendar date.
 * Callers only use its calendar parts (getDate/getDay/ymd), and noon keeps any
 * later setDate() arithmetic clear of DST midnight edges.
 */
export function fleetNow(ref: Date = new Date()): Date {
  const { y, m, d, h } = berlinWallClock(ref);
  const day = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (h < FLEET_DAY_START_HOUR) day.setDate(day.getDate() - 1);
  return day;
}
