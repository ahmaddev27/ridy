// The retake gate, and the image rule that feeds the OCR.
//
// Nothing is typed on a receipt, so a photo that did not yield every required
// field must be refused, and refused with a reason a driver can act on.
//
// Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  evaluateScan,
  evaluateOdometer,
  missingFields,
  causeOf,
  medianSkew,
  junkShare,
  FAR_LINE_PX,
} = await import("../src/lib/scan-quality.ts");
const { ocrResizeFor, OCR_MAX_EDGE, OCR_QUALITY } = await import("../src/lib/ocr-image.ts");
const { photoProblem, submitProblem } = await import("../src/lib/receipt-steps.ts");

const full = {
  date: "2026-10-07",
  amount: 41.47,
  merchant: "ARAL Tankstelle",
  time: "14:32",
  city: "Berlin",
  litres: 23.1,
  pricePerLitre: 1.789,
  fuel: true,
};

/** A line of healthy height and flat, at row `i`. */
const line = (text, i, height = 40) => ({
  text,
  frame: { top: i * 60, left: 10, width: 400, height },
  cornerPoints: [
    { x: 10, y: i * 60 },
    { x: 410, y: i * 60 },
    { x: 410, y: i * 60 + height },
    { x: 10, y: i * 60 + height },
  ],
});
const goodLines = Array.from({ length: 12 }, (_, i) => line(`Zeile Nummer ${i} 12,50`, i));

test("a photo that yielded every required field passes", () => {
  assert.deepEqual(evaluateScan(goodLines, full, { width: 3000, height: 4000 }), { ok: true });
});

test("each required field missing blocks the photo, and is named", () => {
  for (const field of ["date", "amount", "merchant", "time", "city", "litres", "pricePerLitre"]) {
    const facts = { ...full, [field]: undefined };
    const v = evaluateScan(goodLines, facts, { width: 3000, height: 4000 });
    assert.equal(v.ok, false, `${field} missing must block`);
    assert.deepEqual(v.missing, [field]);
  }
});

test("litres and price are demanded on a refuel only", () => {
  const carWash = { ...full, fuel: false, litres: undefined, pricePerLitre: undefined };
  assert.equal(evaluateScan(goodLines, carWash).ok, true);
  assert.deepEqual(missingFields({ ...carWash, fuel: true }), ["litres", "pricePerLitre"]);
});

test("zero, blank and non-positive values do not count as read", () => {
  assert.deepEqual(missingFields({ ...full, amount: 0, merchant: "  ", city: "" }), [
    "amount",
    "merchant",
    "city",
  ]);
});

test("nothing readable at all is its own message", () => {
  const v = evaluateScan([], { fuel: false });
  assert.equal(v.cause, "nothing");
  assert.equal(v.messageKey, "receipt.retakeNothing");
});

test("tiny text against the image reads as too far away", () => {
  const small = Array.from({ length: 12 }, (_, i) => line(`Zeile ${i} 12,50`, i, 12));
  // 12 px on a 4000 px edge is 0.3 %, well under the share.
  assert.equal(causeOf(small, { width: 3000, height: 4000 }), "far");
  // Without the image size the absolute floor applies.
  assert.equal(causeOf(small, null), "far");
  assert.ok(12 < FAR_LINE_PX);
});

test("a steep skew reads as tilted, and a flat page does not", () => {
  const tilted = Array.from({ length: 8 }, (_, i) => ({
    ...line(`Zeile ${i} 12,50`, i),
    cornerPoints: [
      { x: 0, y: 0 },
      { x: 300, y: 200 },
      { x: 300, y: 240 },
      { x: 0, y: 40 },
    ],
  }));
  assert.ok(medianSkew(tilted) > 30);
  assert.equal(causeOf(tilted, { width: 3000, height: 4000 }), "tilted");
  assert.equal(medianSkew(goodLines), 0);
});

test("mostly fragments read as dark or blurred", () => {
  const smear = Array.from({ length: 10 }, (_, i) => line(i % 5 === 0 ? "Aral 12,50" : "-. i", i));
  assert.ok(junkShare(smear) >= 0.5);
  assert.equal(causeOf(smear, { width: 3000, height: 4000 }), "unclear");
});

test("when the cause cannot be told, the message is the generic one", () => {
  // Healthy size, flat, readable lines - but fields are missing. Guessing a
  // cause here would be wrong more often than right.
  const v = evaluateScan(goodLines, { ...full, time: undefined }, { width: 3000, height: 4000 });
  assert.equal(v.cause, "generic");
  assert.equal(v.messageKey, "receipt.retakeGeneric");
});

test("the signals choose the wording and never the verdict", () => {
  // Terrible signals, every field present: still passes.
  assert.equal(evaluateScan([], full).ok, true);
});

test("an odometer the rule abstained on is a retake", () => {
  assert.equal(evaluateOdometer(goodLines, 25382).ok, true);
  const v = evaluateOdometer(goodLines, null);
  assert.equal(v.ok, false);
  assert.equal(v.cause, "generic");
});

test("a failed scan blocks the photo step and the send", () => {
  assert.equal(photoProblem({ hasPhoto: true, scanning: false, needsRetake: true }), "receipt.retakeRequired");
  // Reading is a reason to wait, not to retake.
  assert.equal(photoProblem({ hasPhoto: true, scanning: true, needsRetake: true }), "receipt.scanning");
  // A caller that predates the gate is not blocked.
  assert.equal(photoProblem({ hasPhoto: true, scanning: false }), null);

  const state = {
    photo: { hasPhoto: true, scanning: false, needsRetake: true },
    details: {
      amount: "41,47", category: "Autowäsche", description: "", merchant: "X", city: "Berlin",
      plz: "", receiptTime: "14:32", unconfirmed: false,
    },
    fuel: { litres: "", pricePerLitre: "" },
    odometer: { hasOdoPhoto: false, odometerKm: "" },
  };
  assert.equal(submitProblem(state), "receipt.retakeRequired");
});

test("OCR is never given an enlarged or needlessly shrunk image", () => {
  // The old rule resized to width 1600: upscaling a 1200-wide source and
  // shrinking a 3024-wide portrait by its SHORT side.
  assert.equal(ocrResizeFor(1200, 1600), null);
  assert.equal(ocrResizeFor(3024, 4032), null);
  assert.equal(ocrResizeFor(4032, 3024), null);
  assert.ok(OCR_QUALITY >= 0.9);
});

test("an oversized image is shrunk on its TRUE long edge", () => {
  assert.deepEqual(ocrResizeFor(6000, 8000), { height: OCR_MAX_EDGE });
  assert.deepEqual(ocrResizeFor(8000, 6000), { width: OCR_MAX_EDGE });
  // Unknown dimensions: leave it rather than guess a side.
  assert.equal(ocrResizeFor(undefined, undefined), null);
  assert.equal(ocrResizeFor(0, 9000), null);
});
