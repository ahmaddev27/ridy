import { getLocale } from "./i18n";

/** Prefer the fare Uber already formatted; else format the numeric amount as EUR. */
export function fareLabel(fare_formatted: string | null, fare_amount: number | null): string {
  if (fare_formatted) return fare_formatted;
  if (fare_amount != null) {
    return new Intl.NumberFormat(getLocale(), { style: "currency", currency: "EUR" }).format(fare_amount);
  }
  return "—";
}

export function distanceLabel(meters: number | null): string {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(1)} km`;
}
