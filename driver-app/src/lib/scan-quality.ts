/**
 * The retake gate: did this photo yield a receipt, or must it be taken again?
 *
 * ## Why it exists
 *
 * The owner, 25.10.2026: the driver types NOTHING on a receipt; they
 * photograph it, and a photo that cannot be read is retaken. There is no
 * manual entry and no "send anyway". So the app needs a verdict it can act on,
 * and one it can EXPLAIN - "retake" with no reason teaches a driver to take
 * the same bad photo again.
 *
 * ## What blocks
 *
 * Exactly the fields the app requires to send (`receipt-steps.ts`): date,
 * amount, merchant, city, time, and - on a refuel - litres and price per
 * litre. A photo advances only when every one of them was actually read. The
 * PLZ is not required; it is how the city is obtained (the screen asks the
 * server for the authoritative town of the PLZ it read, and passes that here).
 * The "Unsicher" flag on date/amount is NOT handled here: that is the
 * confirm-by-tap the parser already drives, and it stays.
 *
 * ## What the message says
 *
 * ML Kit exposes no confidence, only text, a frame and corner points per line,
 * so the cause is DERIVED from those, and only claimed when the evidence is
 * unambiguous. In order:
 *
 *   nothing   - zero lines. Nothing readable at all.
 *   far       - the median line is tiny against the image: the receipt is a
 *               small part of the frame. Fixable: get closer.
 *   tilted    - the lines run at a steep angle: the phone is not square to
 *               the paper.
 *   unclear   - lines exist but most are fragments with little alphanumeric
 *               content, which is what blur or darkness produces. Darkness and
 *               blur are NOT told apart - nothing here measures light - so the
 *               message names both.
 *   generic   - everything else. Guessing a cause we cannot see is worse than
 *               "closer, in better light, whole receipt in the frame".
 *
 * The thresholds below are judgement, not measurement: no labelled set of bad
 * photos exists yet. They only choose WORDING; whether the gate blocks never
 * depends on them. That keeps a wrong guess harmless - the driver is still
 * told to retake, just with the generic text.
 */

import type { OcrLine } from './ocr-lines';

/** A line with its corner points, as ML Kit returns them. */
export type ScanLine = OcrLine & { cornerPoints?: ReadonlyArray<{ x: number; y: number }> | null };

/** The fields the gate asks for; each has a `receipt.<name>` label. */
export type RequiredField =
  | 'date'
  | 'amount'
  | 'merchant'
  | 'time'
  | 'city'
  | 'litres'
  | 'pricePerLitre';

export type RetakeCause = 'nothing' | 'far' | 'tilted' | 'unclear' | 'generic';

export type ScanVerdict =
  | { ok: true }
  | { ok: false; cause: RetakeCause; messageKey: string; missing: RequiredField[] };

/** What the reader found. `city` is the RESOLVED one (authoritative if known). */
export type ScanFacts = {
  date?: string | null;
  amount?: number | null;
  merchant?: string | null;
  time?: string | null;
  city?: string | null;
  litres?: number | null;
  pricePerLitre?: number | null;
  /** Whether litres and price are required: a refuel. */
  fuel: boolean;
};

export type ImageSize = { width: number; height: number };

/** A median line shorter than this share of the long edge reads as "far". */
export const FAR_LINE_SHARE = 0.008;
/** Absolute floor in pixels, for when the image size is unknown. */
export const FAR_LINE_PX = 14;
/** Median |angle| of the lines, in degrees, past which the phone is skewed. */
export const TILT_DEGREES = 20;
/** Share of fragment-like lines past which the text reads as blurred/dark. */
export const JUNK_SHARE = 0.5;
/** Fewer lines than this and the junk share is not meaningful. */
export const MIN_LINES_FOR_JUNK = 6;

const MESSAGE: Record<RetakeCause, string> = {
  nothing: 'receipt.retakeNothing',
  far: 'receipt.retakeFar',
  tilted: 'receipt.retakeTilted',
  unclear: 'receipt.retakeUnclear',
  generic: 'receipt.retakeGeneric',
};

function has(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

function hasNumber(v: number | null | undefined): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** The required fields this photo did not yield, in the order a form reads. */
export function missingFields(f: ScanFacts): RequiredField[] {
  const out: RequiredField[] = [];
  if (!has(f.date)) out.push('date');
  if (!hasNumber(f.amount)) out.push('amount');
  if (!has(f.merchant)) out.push('merchant');
  if (!has(f.time)) out.push('time');
  if (!has(f.city)) out.push('city');
  if (f.fuel && !hasNumber(f.litres)) out.push('litres');
  if (f.fuel && !hasNumber(f.pricePerLitre)) out.push('pricePerLitre');
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median line height in pixels, or 0 when no line has a frame. */
export function medianLineHeight(lines: ScanLine[]): number {
  return median(
    lines
      .map((l) => l.frame?.height)
      .filter((h): h is number => typeof h === 'number' && Number.isFinite(h) && h > 0),
  );
}

/** Angle of a line's top edge from its corner points, 0..90 degrees. */
function lineAngle(line: ScanLine): number | null {
  const p = line.cornerPoints;
  if (!p || p.length < 2) return null;
  const dx = p[1].x - p[0].x;
  const dy = p[1].y - p[0].y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
  const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  return deg > 90 ? 180 - deg : deg;
}

/** Median skew of the lines in degrees, or null when no corners were given. */
export function medianSkew(lines: ScanLine[]): number | null {
  const angles = lines.map(lineAngle).filter((a): a is number => a !== null);
  return angles.length === 0 ? null : median(angles);
}

/** A line with almost no letters or digits: what a smeared read yields. */
function isFragment(text: string): boolean {
  const t = text.trim();
  const alnum = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return alnum < 3 || alnum / t.length < 0.5;
}

/** Share of non-empty lines that are fragments. */
export function junkShare(lines: ScanLine[]): number {
  const kept = lines.filter((l) => l.text.trim() !== '');
  if (kept.length === 0) return 0;
  return kept.filter((l) => isFragment(l.text)).length / kept.length;
}

function isFar(lines: ScanLine[], image?: ImageSize | null): boolean {
  const h = medianLineHeight(lines);
  if (h === 0) return false;
  if (image && image.width > 0 && image.height > 0) {
    return h / Math.max(image.width, image.height) < FAR_LINE_SHARE;
  }
  return h < FAR_LINE_PX;
}

/** Why a photo that failed the gate most likely failed. */
export function causeOf(lines: ScanLine[], image?: ImageSize | null): RetakeCause {
  const kept = lines.filter((l) => l.text.trim() !== '');
  if (kept.length === 0) return 'nothing';
  if (isFar(kept, image)) return 'far';
  const skew = medianSkew(kept);
  if (skew !== null && skew > TILT_DEGREES) return 'tilted';
  if (kept.length >= MIN_LINES_FOR_JUNK && junkShare(kept) >= JUNK_SHARE) return 'unclear';
  return 'generic';
}

/**
 * The verdict for one scan. Blocks iff a required field is missing; the
 * clarity signals only pick the wording.
 */
export function evaluateScan(lines: ScanLine[], facts: ScanFacts, image?: ImageSize | null): ScanVerdict {
  const missing = missingFields(facts);
  if (missing.length === 0) return { ok: true };
  const cause = causeOf(lines, image);
  return { ok: false, cause, messageKey: MESSAGE[cause], missing };
}

/**
 * The odometer, same idea: the rule abstains (`odometerKm` null) rather than
 * guess, and with no typing an abstention can only mean "retake". `ODOMETER_MIN`
 * is untouched; the wording reuses the same signals.
 */
export function evaluateOdometer(
  lines: ScanLine[],
  odometerKm: number | null,
  image?: ImageSize | null,
): ScanVerdict {
  if (odometerKm !== null) return { ok: true };
  const cause = causeOf(lines, image);
  return { ok: false, cause, messageKey: MESSAGE[cause], missing: [] };
}
