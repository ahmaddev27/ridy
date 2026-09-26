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
