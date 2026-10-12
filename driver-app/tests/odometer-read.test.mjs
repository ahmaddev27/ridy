// Reading the odometer out of a cluster's text.
//
// The fixtures below are the text that really appears on these clusters, taken
// from four of the 59 photos measured on 12.10.2026. The odometer values are
// the ones read by eye from those photos, so a failure here is a failure
// against the actual panel and not against an invented example.
//
// The case that matters most is the LAST one: no five-digit value, so no
// answer. A vision model given the same photos answered all 59 and abstained
// zero times, and on one of them returned the remaining range as the odometer.
// A wrong five-digit number looks exactly like a right one, and the photo does
// not travel, so nobody downstream can catch it.
//
// Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";

const { readOdometer } = await import("../src/lib/odometer-read.ts");

const lines = (...texts) => texts.map((text) => ({ text }));

test("a night photo: the odometer and the range, told apart", () => {
  // The panel of `11.39.41 AM.jpeg`, read by eye: 25382 km, range 277 km.
  const r = readOdometer(lines(
    "14 °C", "4:24", "0", "km/h", "P", "ECO",
    "Ø s. Rücks.", "4.6 L/100km",
    "READY", "25382km",
    "277 km", "1/1 km/h",
  ));
  assert.equal(r.odometerKm, 25382);
  assert.equal(r.rangeKm, 277);
  assert.equal(r.problem, undefined);
});

test("a daylight photo with a bigger range", () => {
  // `11.39.41 AM (1).jpeg`: 18752 km, range 854 km.
  const r = readOdometer(lines(
    "17°C", "23:12", "0 km/h", "Total Average", "4.4 L/100km",
    "READY", "18752km", "854 km",
  ));
  assert.equal(r.odometerKm, 18752);
  assert.equal(r.rangeKm, 854);
});

test("`L/100km` is never a candidate", () => {
  // The `100` inside it is what a naive grep picks up, and it is neither an
  // odometer nor a range.
  const r = readOdometer(lines("4.5 L/100km", "22763km", "388 km"));
  assert.equal(r.odometerKm, 22763);
  assert.equal(r.rangeKm, 388);
});

test("the speed is never a candidate, whatever the number", () => {
  // At 120 km/h the speed is larger than the range, and still not either.
  const r = readOdometer(lines("120 km/h", "24820km", "199 km"));
  assert.equal(r.odometerKm, 24820);
  assert.equal(r.rangeKm, 199);
});

test("no five-digit value: it abstains instead of taking the range", () => {
  // This is the failure a model made on a real photo. The range is still
  // reported — it was read honestly — but the odometer is null, and the app
  // asks the driver.
  const r = readOdometer(lines("0 km/h", "691 km", "READY"));
  assert.equal(r.odometerKm, null);
  assert.equal(r.rangeKm, 691);
  assert.equal(r.problem, "too_small");
});

test("no km anywhere: it says which kind of nothing it found", () => {
  const r = readOdometer(lines("21 °C", "18:13", "P"));
  assert.equal(r.odometerKm, null);
  assert.equal(r.rangeKm, null);
  assert.equal(r.problem, "no_km_value");
});

test("no text at all", () => {
  assert.deepEqual(readOdometer([]), { odometerKm: null, rangeKm: null, problem: "no_text" });
  assert.deepEqual(readOdometer(lines("", "   ")), { odometerKm: null, rangeKm: null, problem: "no_text" });
});

test("a trip meter does not become the range", () => {
  // A six-digit total and a four-digit trip: the trip is above RANGE_MAX and
  // is not offered as a range.
  const r = readOdometer(lines("123456km", "2962 km", "277 km"));
  assert.equal(r.odometerKm, 123456);
  assert.equal(r.rangeKm, 277);
});

test("two values on one line are both seen", () => {
  // An OCR engine often returns a whole row as one string. A shared global
  // regex would skip the second match on the next call; this one must not.
  const r = readOdometer(lines("25382km 277 km"));
  assert.equal(r.odometerKm, 25382);
  assert.equal(r.rangeKm, 277);
});

test("the same reading twice gives the same answer", () => {
  // Determinism is the property a model cannot offer and the reason this is a
  // rule: the same photo must never produce two different figures.
  const input = lines("READY", "20961km", "755 km", "0 km/h");
  assert.deepEqual(readOdometer(input), readOdometer(input));
});
