import { clsx, type ClassValue } from "clsx";

/** Merge conditional class names. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * A BCP-47 tag that keeps the locale's language (so month/day names stay
 * localized) but forces Latin/Western digits — Arabic (or any other locale with
 * native numerals) must never render Arabic-Indic numerals for prices,
 * distances or dates.
 */
export function latnLocale(locale: string | null | undefined): string {
  const base = locale || "de";
  if (base.includes("-u-")) return base.includes("-nu-") ? base : `${base}-nu-latn`;
  return `${base}-u-nu-latn`;
}

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

/** Convert any Arabic-Indic / Persian digits in a string to Latin 0-9. */
export function toLatinDigits(input: string | null | undefined): string {
  if (input == null) return "";
  return String(input).replace(EASTERN_DIGITS, (ch) => String(ch.charCodeAt(0) & 0xf));
}

/** Keep only the Latin digits of user input (Arabic-Indic digits are converted first). */
export function digitsOnly(input: string | null | undefined): string {
  return toLatinDigits(input).replace(/\D/g, "");
}

/** A number in the UI locale with Latin digits. */
export function formatNumber(n: number | null | undefined, locale: string, options?: Intl.NumberFormatOptions): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat(latnLocale(locale), options).format(Number(n));
}

/** A money amount ("62.595,12 €" in German) with Latin digits; "—" when missing. */
export function formatMoney(
  amount: number | string | null | undefined,
  locale: string,
  currency = "EUR",
): string {
  if (amount == null || amount === "" || Number.isNaN(Number(amount))) return "—";
  return new Intl.NumberFormat(latnLocale(locale), {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/** A date (no time) in the UI locale with Latin digits; "—" when missing. */
export function formatDate(
  iso: string | number | Date | null | undefined,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (iso == null || iso === "") return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(latnLocale(locale), options);
}

/** A date + time in the UI locale with Latin digits; "—" when missing. */
export function formatDateTime(
  iso: string | number | Date | null | undefined,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (iso == null || iso === "") return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(latnLocale(locale), options);
}

// One formatter per locale (relTime runs for every cell on each 30 s refetch).
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  const key = locale || "en";
  let rtf = rtfCache.get(key);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(latnLocale(key), { numeric: "auto", style: "short" });
    rtfCache.set(key, rtf);
  }
  return rtf;
}

/** Short relative time (e.g. "3m ago"). Falls back to `never` when null. */
export function relTime(iso: string | null, locale: string, never: string): string {
  if (!iso) return never;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return never;
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = relativeFormatter(locale);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

/** A not-yet-expired Uber token turns amber when it is closer than this. */
export const TOKEN_WARN_MS = 12 * 3600 * 1000;
