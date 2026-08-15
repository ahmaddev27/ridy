// Money, distance and prices always render with Latin digits — even when the app
// language is Arabic — matching how Uber shows them. So we deliberately format
// with a Latin locale, never the app locale.
const LATIN = "en-DE";

/** Prefer the fare Uber already formatted; else format the numeric amount as EUR. */
export function fareLabel(fare_formatted: string | null, fare_amount: number | null): string {
  if (fare_formatted) return fare_formatted;
  if (fare_amount != null) {
    return new Intl.NumberFormat(LATIN, { style: "currency", currency: "EUR" }).format(fare_amount);
  }
  return "—";
}

export function distanceLabel(meters: number | null): string {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(1)} km`;
}

/** €/km, Latin digits. */
export function perKmLabel(fare_amount: number | null, meters: number | null): string {
  if (fare_amount == null || !meters) return "—";
  const perKm = fare_amount / (meters / 1000);
  return `${new Intl.NumberFormat(LATIN, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(perKm)} €/km`;
}

/** Keep "Street No, Postcode City" — drop the trailing country. */
export function cleanAddress(addr: string | null): string {
  if (!addr) return "—";
  return addr.replace(/,\s*(Deutschland|Germany|Alemania|ألمانيا)\s*$/i, "").trim();
}

/** Time-of-day in Latin digits, 24h. */
export function timeLabel(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(LATIN, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}
