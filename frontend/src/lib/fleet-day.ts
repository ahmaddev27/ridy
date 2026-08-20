// The fleet/business day follows Uber: it starts at 04:00, not midnight, so a
// trip at 02:30 belongs to the PREVIOUS calendar day's fleet-day. Anchoring a
// moment back by 4h makes its calendar date the fleet-day it belongs to, which
// keeps the dashboard's date filters and day grouping in sync with the backend
// (App\Support\FleetDay) and the mobile app.

export const FLEET_DAY_START_HOUR = 4;

/** A moment shifted so its calendar date is the fleet-day it belongs to. */
export function fleetNow(ref: Date = new Date()): Date {
  return new Date(ref.getTime() - FLEET_DAY_START_HOUR * 3600 * 1000);
}

/** yyyy-mm-dd of the fleet-day for the given moment (now by default). */
export function fleetYmd(ref: Date = new Date()): string {
  const d = fleetNow(ref);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
