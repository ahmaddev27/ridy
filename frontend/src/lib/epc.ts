/**
 * Builds the payload string for an EPC069-12 "GiroCode" QR — the SEPA credit
 * transfer QR that German/EU banking apps scan to prefill a transfer. Encoding
 * the company's payment reference into the (unstructured) remittance field means
 * every scanned transfer carries the token that maps it back to the company.
 *
 * The amount is optional (left open when no plan is chosen); name + IBAN are
 * required — the caller must not render a QR without them.
 */
export function buildEpcPayload(o: {
  name: string;
  iban: string;
  bic?: string | null;
  amountEur?: number | null;
  reference?: string | null;
}): string {
  const iban = (o.iban || "").replace(/\s+/g, "").toUpperCase();
  const bic = (o.bic || "").replace(/\s+/g, "").toUpperCase();
  const amount = o.amountEur && o.amountEur > 0 ? `EUR${o.amountEur.toFixed(2)}` : "";

  // Fixed 11-line EPC069-12 (version 002, UTF-8) layout.
  return [
    "BCD", // service tag
    "002", // version
    "1", // charset: UTF-8
    "SCT", // SEPA credit transfer
    bic,
    (o.name || "").slice(0, 70),
    iban,
    amount,
    "", // purpose
    "", // structured remittance
    (o.reference || "").slice(0, 140), // unstructured remittance → the company reference
  ].join("\n");
}

/** Whether we have the minimum (name + IBAN) to render a scannable QR. */
export function canBuildEpc(o: { name?: string | null; iban?: string | null }): boolean {
  return !!(o.name && o.name.trim() && o.iban && o.iban.trim());
}
