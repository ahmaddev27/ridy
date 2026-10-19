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
