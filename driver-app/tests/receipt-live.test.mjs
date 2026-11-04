// The live-scan decisions (docs/26): coverage %, guidance, debounce, auto-capture.
// Pure functions only - no camera, no OCR engine. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";

const L = await import("../src/lib/receipt-live.ts");

const FUEL_FULL = { amount: 74.24, date: "2026-10-09", merchantName: "ARAL", litres: 41.47 };
const W = 1000;
const H = 1400;
const box = (top, left, width, height) => ({ top, left, width, height });
const sig = (over = {}) => ({
  lineCount: 12,
  textBox: box(200, 150, 700, 900),
  imageWidth: W,
  imageHeight: H,
  ...over,
});

test("coverage: nothing read is 0", () => {
  assert.equal(L.coverageScore({}, 5), 0);
});

test("coverage: weights total 40 / date 20 / station 20 / litres 20 at full stability", () => {
  assert.equal(L.coverageScore(FUEL_FULL, 2), 100);
  assert.equal(L.coverageScore({ ...FUEL_FULL, amount: undefined }, 2), 60);
  assert.equal(L.coverageScore({ ...FUEL_FULL, date: undefined }, 2), 80);
  assert.equal(L.coverageScore({ ...FUEL_FULL, merchantName: undefined }, 2), 80);
  assert.equal(L.coverageScore({ ...FUEL_FULL, litres: undefined, pricePerLitre: 1.79 }, 2), 80);
});

test("coverage: a fresh read is discounted until it holds still", () => {
  assert.equal(L.coverageScore(FUEL_FULL, 0), 60);
  assert.equal(L.coverageScore(FUEL_FULL, 1), 80);
  assert.equal(L.coverageScore(FUEL_FULL, 2), 100);
  assert.equal(L.coverageScore(FUEL_FULL, 99), 100);
});

test("coverage: a non-fuel receipt is not capped by missing litres", () => {
  assert.equal(L.coverageScore({ amount: 12.5, date: "2026-10-09", merchantName: "Waschpark" }, 2), 100);
});

test("coverage: a stationName alone counts as the station", () => {
  assert.equal(L.coverageScore({ amount: 5, date: "2026-10-09", stationName: "JET" }, 2), 100);
});

test("stability streak extends on an identical read and resets on change/empty", () => {
  let s = L.INITIAL_STABILITY;
  s = L.advanceStability(s, FUEL_FULL);
  assert.equal(s.streak, 0);
  s = L.advanceStability(s, FUEL_FULL);
  s = L.advanceStability(s, FUEL_FULL);
  assert.equal(s.streak, 2);
  s = L.advanceStability(s, { ...FUEL_FULL, amount: 74.2 });
  assert.equal(s.streak, 0);
  s = L.advanceStability(s, {});
  assert.deepEqual(s, { signature: "", streak: 0 });
});

test("auto-capture needs BOTH coverage and a stable run", () => {
  assert.equal(L.shouldAutoCapture(100, 3), true);
  assert.equal(L.shouldAutoCapture(90, 3), true);
  assert.equal(L.shouldAutoCapture(89, 9), false);
  assert.equal(L.shouldAutoCapture(100, 2), false);
});

test("auto-capture end to end: fires on the 4th identical full read, not before", () => {
  let st = L.INITIAL_STABILITY;
  const fired = [];
  for (let i = 0; i < 5; i++) {
    st = L.advanceStability(st, FUEL_FULL);
    fired.push(L.shouldAutoCapture(L.coverageScore(FUEL_FULL, st.streak), st.streak));
  }
  assert.deepEqual(fired, [false, false, false, true, true]);
});

test("hint: no text asks to put the receipt in frame", () => {
  assert.equal(L.rawHint(sig({ lineCount: 0, textBox: null })), "receipt.live.hintNoText");
});

test("hint: text hugging the top says move up, the bottom says move down", () => {
  assert.equal(L.rawHint(sig({ textBox: box(5, 150, 700, 800) })), "receipt.live.hintMoveUp");
  assert.equal(L.rawHint(sig({ textBox: box(500, 150, 700, 895) })), "receipt.live.hintMoveDown");
});

test("hint: clipped on both axes ends says fit it all", () => {
  assert.equal(L.rawHint(sig({ textBox: box(5, 150, 700, 1395) })), "receipt.live.hintFitAll");
  assert.equal(L.rawHint(sig({ textBox: box(300, 5, 995, 500) })), "receipt.live.hintFitAll");
});

test("hint: small text says closer; few lines says hold steady", () => {
  assert.equal(L.rawHint(sig({ textBox: box(300, 400, 300, 400) })), "receipt.live.hintCloser");
  assert.equal(L.rawHint(sig({ lineCount: 2 })), "receipt.live.hintSteady");
});

test("hint: glare outranks framing; a good frame has nothing to say until ready", () => {
  assert.equal(L.rawHint(sig({ glare: true, textBox: box(5, 150, 700, 800) })), "receipt.live.hintGlare");
  assert.equal(L.rawHint(sig()), null);
  assert.equal(L.rawHint(sig({ ready: true })), "receipt.live.hintHold");
});

test("textBounds / signalsFrom: union of line frames; missing frames ignored", () => {
  const lines = [
    { text: "a", frame: box(100, 50, 200, 20) },
    { text: "b", frame: box(500, 80, 300, 30) },
    { text: "c" },
  ];
  assert.deepEqual(L.textBounds(lines), box(100, 50, 330, 430));
  assert.equal(L.textBounds([{ text: "x" }]), null);
  assert.equal(L.signalsFrom(lines, W, H).lineCount, 3);
});

test("debounce: a new hint shows only after 2 identical frames; a blip does not flip it", () => {
  const A = "receipt.live.hintCloser";
  const B = "receipt.live.hintMoveUp";
  let h = L.INITIAL_HINT;
  h = L.debounceHint(h, A);
  assert.equal(h.shown, null);
  h = L.debounceHint(h, A);
  assert.equal(h.shown, A);
  h = L.debounceHint(h, B); // one-frame blip
  assert.equal(h.shown, A);
  h = L.debounceHint(h, A); // back: pending cleared
  assert.deepEqual(h, { shown: A, pending: null, repeats: 0 });
  h = L.debounceHint(h, B);
  h = L.debounceHint(h, B);
  assert.equal(h.shown, B);
  h = L.debounceHint(h, null);
  h = L.debounceHint(h, null);
  assert.equal(h.shown, null);
});
