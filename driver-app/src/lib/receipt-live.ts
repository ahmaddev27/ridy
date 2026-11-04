/**
 * The decisions behind the live receipt scan (docs/26), as pure functions.
 *
 * The camera screen only does I/O: it snaps a small frame every few hundred
 * ms, runs the SAME on-device OCR + `parseReceiptText` as the still-photo flow,
 * and feeds the result here. Everything that DECIDES - how much of the receipt
 * has been read, what to tell the driver, when to take the real photo - lives
 * in this file with no React, camera or native import, so it is unit-tested.
 *
 * No frame leaves the phone; these functions never see pixels, only the text
 * lines the recogniser found and where they sit.
 *
 * Numbers are returned as plain JS numbers; the screen renders them with
 * `String(n)`, which is always Latin digits (also in Arabic, by house rule).
 */

import type { OcrResult } from "@/lib/receipt-text-parse";
import type { OcrLine } from "@/lib/ocr-lines";

// ---- coverage ---------------------------------------------------------------

/** Field weights, in percent, for a fuel receipt (they sum to 100). */
export const FUEL_WEIGHTS = { total: 40, date: 20, station: 20, litres: 20 } as const;
/** A receipt with no fuel figures has no litres to find: its 20 is shared out. */
export const GENERIC_WEIGHTS = { total: 50, date: 25, station: 25, litres: 0 } as const;

/** Stability multiplier by consecutive-unchanged-frames: 0.6, 0.8, then 1. */
const STABILITY_BASE = 0.6;
const STABILITY_STEP = 0.2;

export function stabilityFactor(streak: number): number {
  const s = Number.isFinite(streak) ? Math.max(0, streak) : 0;
  return Math.min(1, STABILITY_BASE + STABILITY_STEP * s);
}

function expectsLitres(parsed: OcrResult): boolean {
  return parsed.litres !== undefined || parsed.pricePerLitre !== undefined || parsed.category === "Tanken";
}

/** Which key fields this read has, weighted. Exposed for tests and tuning. */
export function fieldScore(parsed: OcrResult): number {
  const w = expectsLitres(parsed) ? FUEL_WEIGHTS : GENERIC_WEIGHTS;
  let score = 0;
  if (parsed.amount !== undefined) score += w.total;
  if (parsed.date) score += w.date;
  if (parsed.merchantName || parsed.stationName) score += w.station;
  if (parsed.litres !== undefined) score += w.litres;
  return score;
}

/** 0..100, whole number: weighted key-field presence x stability. */
export function coverageScore(parsed: OcrResult, stableStreak = 0): number {
  return Math.round(fieldScore(parsed) * stabilityFactor(stableStreak));
}

// ---- stability across frames ------------------------------------------------

export interface StabilityState {
  signature: string;
  streak: number;
}

export const INITIAL_STABILITY: StabilityState = { signature: "", streak: 0 };

/** The values whose change means "the read is still moving". */
export function readSignature(parsed: OcrResult): string {
  const parts = [parsed.amount, parsed.date, parsed.merchantName ?? parsed.stationName, parsed.litres];
  return parts.some((p) => p !== undefined) ? parts.map((p) => String(p ?? "")).join("|") : "";
}

/** Same non-empty read as the previous frame extends the streak; else resets. */
export function advanceStability(prev: StabilityState, parsed: OcrResult): StabilityState {
  const signature = readSignature(parsed);
  if (signature === "") return { signature, streak: 0 };
  return { signature, streak: signature === prev.signature ? prev.streak + 1 : 0 };
}

// ---- auto-capture -----------------------------------------------------------

export const AUTO_CAPTURE_COVERAGE = 90;
export const AUTO_CAPTURE_STABLE_FRAMES = 3;

export function shouldAutoCapture(
  coverage: number,
  stableFrames: number,
  minCoverage = AUTO_CAPTURE_COVERAGE,
  minFrames = AUTO_CAPTURE_STABLE_FRAMES,
): boolean {
  return coverage >= minCoverage && stableFrames >= minFrames;
}

// ---- guidance ---------------------------------------------------------------

export type HintKey =
  | "receipt.live.hintNoText"
  | "receipt.live.hintCloser"
  | "receipt.live.hintMoveUp"
  | "receipt.live.hintMoveDown"
  | "receipt.live.hintFitAll"
  | "receipt.live.hintSteady"
  | "receipt.live.hintGlare"
  | "receipt.live.hintHold";

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface GuidanceSignals {
  lineCount: number;
  /** Union of all text lines, in frame pixels; null when there is no text. */
  textBox: Box | null;
  imageWidth: number;
  imageHeight: number;
  /** Optional: not derivable from OCR output; reserved for a pixel probe. */
  glare?: boolean;
  /** The read is complete and steady; tell the driver to keep still. */
  ready?: boolean;
}

/** Text spanning less than this share of the frame width is "too far". */
export const MIN_TEXT_WIDTH_SHARE = 0.45;
/** Fewer lines than this is a blurred / half-found read, not a receipt. */
export const MIN_LINES = 4;
/** Text within this share of an edge is touching it (probably cut off). */
export const EDGE_MARGIN = 0.03;

/** The box around every line that has a frame; null when none does. */
export function textBounds(lines: OcrLine[]): Box | null {
  const frames = lines.map((l) => l.frame).filter((f): f is NonNullable<typeof f> => !!f);
  if (frames.length === 0) return null;
  const top = Math.min(...frames.map((f) => f.top));
  const left = Math.min(...frames.map((f) => f.left));
  const bottom = Math.max(...frames.map((f) => f.top + f.height));
  const right = Math.max(...frames.map((f) => f.left + f.width));
  return { top, left, width: right - left, height: bottom - top };
}

export function signalsFrom(lines: OcrLine[], imageWidth: number, imageHeight: number): GuidanceSignals {
  return { lineCount: lines.length, textBox: textBounds(lines), imageWidth, imageHeight };
}

function edges(s: GuidanceSignals, box: Box) {
  const m = EDGE_MARGIN;
  return {
    top: box.top < s.imageHeight * m,
    bottom: box.top + box.height > s.imageHeight * (1 - m),
    left: box.left < s.imageWidth * m,
    right: box.left + box.width > s.imageWidth * (1 - m),
  };
}

/**
 * The single most useful instruction for ONE frame, or null when there is
 * nothing to say. Priority: no text > glare > framing > distance > steadiness.
 *
 * "Move up/down" are about the PHONE: text hugging the top edge means the
 * receipt continues above the frame, so the phone goes up.
 */
export function rawHint(s: GuidanceSignals): HintKey | null {
  if (s.lineCount === 0 || !s.textBox || s.imageWidth <= 0 || s.imageHeight <= 0) {
    return "receipt.live.hintNoText";
  }
  if (s.glare) return "receipt.live.hintGlare";
  const e = edges(s, s.textBox);
  if (e.top && e.bottom) return "receipt.live.hintFitAll";
  if (e.top) return "receipt.live.hintMoveUp";
  if (e.bottom) return "receipt.live.hintMoveDown";
  if (e.left && e.right) return "receipt.live.hintFitAll";
  if (s.textBox.width < s.imageWidth * MIN_TEXT_WIDTH_SHARE) return "receipt.live.hintCloser";
  if (s.lineCount < MIN_LINES) return "receipt.live.hintSteady";
  return s.ready ? "receipt.live.hintHold" : null;
}

// ---- debounce ---------------------------------------------------------------

export interface HintState {
  /** What is currently shown. */
  shown: HintKey | null;
  /** What the last frames have been asking for, and for how long. */
  pending: HintKey | null;
  repeats: number;
}

export const INITIAL_HINT: HintState = { shown: null, pending: null, repeats: 0 };
/** A new hint must be asked for this many frames in a row before it shows. */
export const HINT_CONFIRM_FRAMES = 2;

/** Switch the shown hint only after `confirm` consecutive identical requests. */
export function debounceHint(prev: HintState, candidate: HintKey | null, confirm = HINT_CONFIRM_FRAMES): HintState {
  if (candidate === prev.shown) return { shown: prev.shown, pending: null, repeats: 0 };
  const repeats = candidate === prev.pending ? prev.repeats + 1 : 1;
  if (repeats >= confirm) return { shown: candidate, pending: null, repeats: 0 };
  return { shown: prev.shown, pending: candidate, repeats };
}
