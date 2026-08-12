import { clsx, type ClassValue } from "clsx";

/** Merge conditional class names. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * A BCP-47 tag that keeps the locale's language (so month/day names stay
 * localized) but forces Latin/Western digits — Arabic must never render
 * Arabic-Indic numerals for prices, distances or dates.
 */
export function latnLocale(locale: string): string {
  return locale.startsWith("ar") ? "ar-u-nu-latn" : locale;
}

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

/** Convert any Arabic-Indic / Persian digits in a string to Latin 0-9. */
export function toLatinDigits(input: string | null | undefined): string {
  if (input == null) return "";
  return String(input).replace(EASTERN_DIGITS, (ch) => String(ch.charCodeAt(0) & 0xf));
}
