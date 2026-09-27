// ONE fixed money/distance shape everywhere — German format with Latin digits:
//   fare  → "4,10 €"      (comma decimal, € after the amount)
//   €/km  → "1,77 €/km"
//   dist. → "2,3 km"
// Even when the app language is Arabic the digits stay Latin (de-DE uses Latin
// digits), matching how Uber shows fares in Germany. We format from the NUMERIC
// amount and never trust Uber's pre-formatted string (it mixes "EUR" and "€",
// and flips the symbol side) — that was the source of the inconsistent display.
const MONEY = "de-DE";
const eur = new Intl.NumberFormat(MONEY, { style: "currency", currency: "EUR" });
const num2 = new Intl.NumberFormat(MONEY, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num1 = new Intl.NumberFormat(MONEY, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The trip total as a fixed EUR string ("4,10 €"). Always formats the numeric
 *  amount; only falls back to Uber's string when we have no amount at all. */
export function fareLabel(fare_formatted: string | null, fare_amount: number | null): string {
  if (fare_amount != null) return eur.format(fare_amount);
  return fare_formatted ?? "—";
}

export function distanceLabel(meters: number | null): string {
  if (meters == null) return "—";
  return `${num1.format(meters / 1000)} km`;
}

/** €/km as one fixed string ("1,77 €/km"). */
export function perKmLabel(fare_amount: number | null, meters: number | null): string {
  if (fare_amount == null || !meters) return "—";
  return `${num2.format(fare_amount / (meters / 1000))} €/km`;
}

/**
 * The €/km hero split for the offer card: the bare numeric `value` ("1,77", to be
 * shown next to a "€/km" label) plus whether the rate is strong. Returns null when
 * it can't be computed, so the card can fall back to a dash.
 */
export function perKmValue(
  fare_amount: number | null,
  meters: number | null,
): { value: string; rate: number; good: boolean } | null {
  if (fare_amount == null || !meters) return null;
  const rate = fare_amount / (meters / 1000);
  return { value: num2.format(rate), rate, good: rate > 1 };
}

/** Keep "Street No, Postcode City" — drop the trailing country. */
export function cleanAddress(addr: string | null): string {
  if (!addr) return "—";
  return addr.replace(/,\s*(Deutschland|Germany|Alemania|ألمانيا)\s*$/i, "").trim();
}

/** Date + time in Latin digits, 24h (kept as "02/09, 11:12" — unchanged). */
const TIME = "en-DE";
export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(TIME, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

/** Time of day only ("11:12"), 24h, Latin digits. */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(TIME, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Day + month only ("02/09"), Latin digits. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(TIME, { day: "2-digit", month: "2-digit" });
}

/**
 * Normalise Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) digits to ASCII, so a
 * driver typing on an Arabic keyboard can still enter a numeric code.
 */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
