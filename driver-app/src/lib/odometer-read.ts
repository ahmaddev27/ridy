/**
 * Reading a car's odometer out of the text an OCR engine found on its cluster.
 *
 * ## Why this is a rule and not a model
 *
 * Measured on 59 real photos of this fleet's clusters, 12.10.2026:
 *
 * - `gemma3:4b`, a vision model, answered all 59 and **abstained zero times**.
 *   15 of its answers were impossible by magnitude alone, and on one photo it
 *   read `691` — the remaining RANGE — where the odometer said `25041`. A
 *   wrong five-digit number looks exactly like a right one.
 * - A plain OCR pass plus the rule below picked a value on 35 of 59 and said
 *   "I could not" on the other 24. **34 of the 35 were plausible**, and every
 *   one checked by eye was exact.
 *
 * The abstention is the whole point. A reading nobody can check — the photo
 * stays on the phone — is only safe if the thing producing it will admit when
 * it does not know, so the driver can be asked instead of being believed.
 *
 * ## What the cluster shows, and how each is told apart
 *
 *     0 km/h          the speed          — the unit has a slash
 *     4.6 L/100km     consumption        — `km` is inside `L/100km`
 *     14 °C           outside temp       — not km at all
 *     4:24            the clock          — not km at all
 *     277 km          remaining range    — bare km, but small
 *     25382 km        THE ODOMETER       — bare km, and large
 *
 * So the rule is: a run of digits followed by a bare `km`, the largest wins,
 * and it must be at least five digits. Everything else is not a candidate.
 *
 * ## The range is the fuel reading
 *
 * The fuel gauge is a bar of lit blocks, not text, and nothing read it: the
 * vision model answered `three_quarters` on 41 of 59 photos including one
 * whose bar was visibly a quarter. The range beside it IS text, and it is a
 * better answer anyway — `199 km` left says something a driver and a fleet
 * manager can both act on, where "about half" does not.
 */

/** A line as an OCR engine gives it. The frame is unused here and optional. */
export type OdoLine = { text: string };

export type OdometerReading = {
  /** Total distance, or null when the rule would have had to guess. */
  odometerKm: number | null;
  /** Remaining range in km, the readable stand-in for the fuel gauge. */
  rangeKm: number | null;
  /** Present only when `odometerKm` is null, and names which case it was. */
  problem?: 'no_text' | 'no_km_value' | 'too_small';
};

/**
 * Digits followed by `km` that is NOT part of `km/h` or `L/100km`.
 *
 * The trailing group is what does the work: a slash after the unit means
 * speed, and a `/` before the number means it came out of `L/100km`.
 */
const BARE_KM = /(^|[^/\d])(\d{2,7})\s*km(?![/\w])/gi;

/** Below this a number is a range, a trip meter or noise - never a total. */
const ODOMETER_MIN = 10000;

/** A range of more than this is not a range; a car does not hold it. */
const RANGE_MAX = 2000;

/** Every bare-km number on the panel, largest first. */
function kmValues(lines: OdoLine[]): number[] {
  const found: number[] = [];
  for (const line of lines) {
    if (typeof line.text !== 'string') continue;
    // A fresh matcher per line: a shared /g regex carries lastIndex between
    // calls and silently skips the start of the next string.
    const re = new RegExp(BARE_KM.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text)) !== null) {
      const n = Number(m[2]);
      if (Number.isFinite(n)) found.push(n);
    }
  }
  return found.sort((a, b) => b - a);
}

/**
 * Read the odometer and the range, or say which of them could not be read.
 *
 * It never returns a number it is not entitled to: with no bare-km value, or
 * with nothing at or above five digits, `odometerKm` is null and the caller
 * asks the driver. That is the behaviour the measurement above exists to
 * protect, and relaxing `ODOMETER_MIN` to "take the largest whatever it is"
 * is what turns an honest blank into a plausible wrong number.
 */
export function readOdometer(lines: OdoLine[]): OdometerReading {
  const kept = lines.filter((l) => typeof l.text === 'string' && l.text.trim() !== '');
  if (kept.length === 0) return { odometerKm: null, rangeKm: null, problem: 'no_text' };

  const values = kmValues(kept);
  if (values.length === 0) return { odometerKm: null, rangeKm: null, problem: 'no_km_value' };

  const odometer = values.find((v) => v >= ODOMETER_MIN) ?? null;

  // The range is the largest bare-km value BELOW the odometer, which on this
  // panel is the only other one. Without an odometer there is nothing to sit
  // below, so the largest plausible range is taken on its own.
  const rangeCandidates = values.filter(
    (v) => v < (odometer ?? Infinity) && v <= RANGE_MAX && v >= 10,
  );
  const range = rangeCandidates.length > 0 ? rangeCandidates[0] : null;

  if (odometer === null) {
    return { odometerKm: null, rangeKm: range, problem: 'too_small' };
  }
  return { odometerKm: odometer, rangeKm: range };
}
