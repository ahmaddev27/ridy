/**
 * What image the phone's OCR is given.
 *
 * ## The defects this replaces
 *
 * The screen used to capture at quality 1 and then hand OCR a copy resized with
 * `{ width: 1600 }` and re-encoded at JPEG 0.7. That threw away the very thing
 * the owner wants maximised, in three ways:
 *
 * - the original was never read, only a lossy, downscaled copy of it;
 * - `width` is the SHORT side of a portrait photo, so "1600 on the long edge"
 *   (the comment's claim) was really a 1600-wide image up to ~2100 tall - and
 *   a landscape one got no relief at all;
 * - a source narrower than 1600 was UPSCALED, which invents pixels and adds
 *   ringing the recogniser then reads as strokes.
 *
 * ## The rule now
 *
 * Never enlarge. Shrink only a source whose LONG edge exceeds `OCR_MAX_EDGE`,
 * and shrink that edge. Re-encode at `OCR_QUALITY` because the re-encode is
 * still wanted: it drops the EXIF block of the cached file (the driver's home
 * GPS), which `exif: false` on the picker does not do.
 *
 * `OCR_MAX_EDGE = 4096`: a 12 MP phone photo (4032 x 3024) passes untouched,
 * which is the common case; a 48-50 MP one is halved. The cap exists for
 * memory only - 4096 x 3072 is ~48 MB as a decoded bitmap, which a mid-range
 * Android handles, while a 100 MP image (~400 MB) would not.
 * `OCR_QUALITY = 0.95`: JPEG artefacts at 0.7 sit exactly on thin digit
 * strokes; at 0.95 they are below what the recogniser can see, for a file of
 * ~2-3 MB that never leaves the phone.
 *
 * The receipt parser was tuned on text read at 1600/0.7. More faithful pixels
 * give the same engine the same or better text; its fixtures are TEXT, so
 * they pin the parser, not this.
 */

export const OCR_MAX_EDGE = 4096;
export const OCR_QUALITY = 0.95;

export type ResizeStep = { width: number } | { height: number };

/**
 * The resize to apply to a source of this size, or null for "leave it".
 *
 * Unknown or nonsensical dimensions mean no resize: an unbounded image is a
 * smaller risk than resizing blind and guessing the wrong side.
 */
export function ocrResizeFor(
  width: number | null | undefined,
  height: number | null | undefined,
): ResizeStep | null {
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (Math.max(width, height) <= OCR_MAX_EDGE) return null;
  return width >= height ? { width: OCR_MAX_EDGE } : { height: OCR_MAX_EDGE };
}
