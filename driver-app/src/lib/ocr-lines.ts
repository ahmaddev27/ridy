/**
 * Rebuilding a receipt's ROWS from what an OCR engine returns.
 *
 * ## Why this exists
 *
 * The receipt rules score on "the label and the amount are on the SAME LINE":
 * `+100 Label: Gesamtbetrag`, `+70 EUR auf gleicher Zeile`. That relationship
 * is the whole of how they tell a total from a litre price or a tax figure.
 *
 * An OCR engine does not return a receipt's rows. It returns blocks and lines
 * of its own choosing, and on a till roll — two columns, a label on the left
 * and a figure on the right — the label and its figure routinely land in
 * DIFFERENT blocks. Joined naively they end up on separate lines, every
 * "same line" rule sees nothing, and the rules pick some other number on the
 * receipt. Measured on a real one: `TOTAL 55,11 EUR` came out as `8,80`.
 *
 * So the lines are put back into rows here, by where they sit on the page.
 *
 * ## The rule
 *
 * Two lines belong to the same row when their vertical centres are closer
 * together than most of a line's height. The threshold is derived from the
 * image itself — the MEDIAN line height — because a receipt photographed from
 * 10 cm and one photographed from 40 cm have nothing in common in pixels, and
 * any fixed number would be right for one and wrong for the other.
 *
 * Within a row, lines are ordered left to right, which is the reading order
 * the rules' regexes assume. Rows are ordered top to bottom.
 *
 * ## What it does NOT do
 *
 * It does not correct the text, drop anything, or judge what a row means.
 * Every line the engine returned appears in exactly one row, so a rule can
 * still find a figure this function placed oddly. Losing text would be worse
 * than placing it badly: a missing total cannot be scored at all.
 */

/** A line as the engine gives it. `frame` is in image pixels. */
export type OcrFrame = { top: number; left: number; width: number; height: number };
export type OcrLine = { text: string; frame?: OcrFrame | null };

/** Joined with two spaces: enough for the rules' `\s` patterns, and it keeps a
 *  label and its figure visibly apart when a human reads the text in a log. */
const JOIN = "  ";

/** Below this the rows would merge into one; above it, nothing would group. */
const MIN_TOLERANCE = 1;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Put the engine's lines back into the receipt's own rows.
 *
 * Lines with no frame cannot be placed, so when ANY line lacks one the input
 * order is returned unchanged — a half-placed page is worse than an unplaced
 * one, because the rules would then score against rows that are partly real.
 */
export function rowsFromLines(lines: OcrLine[]): string[] {
  const kept = lines.filter((l) => typeof l.text === "string" && l.text.trim() !== "");
  if (kept.length === 0) return [];

  const placed = kept.filter(
    (l): l is OcrLine & { frame: OcrFrame } =>
      l.frame != null && Number.isFinite(l.frame.top) && Number.isFinite(l.frame.height),
  );
  if (placed.length !== kept.length) {
    return kept.map((l) => l.text.trim());
  }

  const tolerance = Math.max(MIN_TOLERANCE, median(placed.map((l) => l.frame.height)) * 0.6);

  const byTop = [...placed].sort(
    (a, b) => a.frame.top + a.frame.height / 2 - (b.frame.top + b.frame.height / 2),
  );

  const rows: Array<Array<OcrLine & { frame: OcrFrame }>> = [];
  let current: Array<OcrLine & { frame: OcrFrame }> = [];
  let anchor = 0;

  for (const line of byTop) {
    const centre = line.frame.top + line.frame.height / 2;
    if (current.length === 0) {
      current = [line];
      anchor = centre;
      continue;
    }
    if (Math.abs(centre - anchor) <= tolerance) {
      current.push(line);
      // The anchor follows the row's own centre, so a row that drifts across a
      // tilted photo stays one row instead of splitting halfway along.
      anchor = current.reduce((sum, l) => sum + l.frame.top + l.frame.height / 2, 0) / current.length;
      continue;
    }
    rows.push(current);
    current = [line];
    anchor = centre;
  }
  if (current.length > 0) rows.push(current);

  return rows.map((row) =>
    [...row]
      .sort((a, b) => a.frame.left - b.frame.left)
      .map((l) => l.text.trim())
      .join(JOIN),
  );
}
