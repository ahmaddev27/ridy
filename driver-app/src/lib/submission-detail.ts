/**
 * Reading what the list endpoint says about a submission, for display only.
 *
 * Pure and free of app imports so `node --test` can load it. The values come
 * off the wire as the driver sent them, so none of them is trusted to be
 * present or well-formed: an older server sends no `detail` at all.
 */

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/**
 * "41.47" -> "41,47 €". The wire shape is a plain decimal with a dot, and
 * anything else answers null rather than a guess: a wrong figure in a list the
 * driver treats as his record is worse than no figure. Latin digits in every
 * language, like every other amount in the app.
 */
export function amountLabel(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(raw.trim())) return null;
  return eur.format(Number(raw.trim()));
}

/** Non-empty trimmed text or null. */
export function cleanText(raw: string | null | undefined): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v === "" ? null : v;
}

const DECIMAL = /^\d{1,8}(\.\d{1,3})?$/;

/**
 * "30.50" -> "30,5" / "1.789" -> "1,789", Latin digits whatever the language.
 * Same rule as `amountLabel`: a value that is not the wire shape answers null.
 * The unit is the caller's, so the translation stays out of this pure file.
 */
export function decimalLabel(raw: string | null | undefined, unit: string): string | null {
  if (typeof raw !== "string" || !DECIMAL.test(raw.trim())) return null;
  const n = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(Number(raw.trim()));
  return `${n} ${unit}`;
}

/** "25382" -> "25.382 km". Whole kilometres only; anything else is null. */
export function kmLabel(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !/^\d{1,7}$/.test(raw.trim())) return null;
  return `${new Intl.NumberFormat("de-DE").format(Number(raw.trim()))} km`;
}

/**
 * "2026-10-07" -> a long date in the reader's locale. Built from the parts and
 * not through `new Date("2026-10-07")`, which is UTC midnight and shows the
 * previous day west of Greenwich. `locale` must already force Latin digits
 * (`intlLocale()` does); this file takes it as an argument to stay import-free.
 */
export function dayLabel(raw: string | null | undefined, locale: string): string | null {
  const m = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim()) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric" }).format(d);
}

/** "08:15" stays "08:15"; anything else is null. Never localised: 24-hour, Latin. */
export function clockLabel(raw: string | null | undefined): string | null {
  return typeof raw === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.trim()) ? raw.trim() : null;
}

/** An ISO instant -> date and time in the reader's locale; null when unparsable. */
export function instantLabel(iso: string | null | undefined, locale: string): string | null {
  if (typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);
}
