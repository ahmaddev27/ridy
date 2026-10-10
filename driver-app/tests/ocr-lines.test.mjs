// Rebuilding a receipt's rows from an OCR engine's lines.
//
// The case that matters is the one that was measured on a real receipt: the
// label and its figure sit in different blocks on a two-column till roll, so a
// naive join puts them on separate lines and every "same line" rule in the
// receipt parser sees nothing. `TOTAL 55,11 EUR` came out as `8,80`.
//
// Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";

const { rowsFromLines } = await import("../src/lib/ocr-lines.ts");

/** A line at a given row, with a plausible height. */
const at = (text, top, left, height = 20, width = 100) => ({
  text,
  frame: { top, left, height, width },
});

test("a two-column till roll: the label and its figure become one row", () => {
  // What an engine actually hands back: one block of labels, one of figures.
  const rows = rowsFromLines([
    at("Netto", 100, 10),
    at("MwSt 19%", 130, 10),
    at("TOTAL", 160, 10),
    at("62,39", 102, 220),
    at("11,85", 131, 220),
    at("55,11 EUR", 159, 220),
  ]);

  assert.deepEqual(rows, ["Netto  62,39", "MwSt 19%  11,85", "TOTAL  55,11 EUR"]);
});

test("rows come back top to bottom whatever order the engine used", () => {
  const rows = rowsFromLines([at("third", 300, 0), at("first", 100, 0), at("second", 200, 0)]);
  assert.deepEqual(rows, ["first", "second", "third"]);
});

test("within a row, left to right", () => {
  const rows = rowsFromLines([at("right", 100, 400), at("left", 100, 10), at("middle", 100, 200)]);
  assert.deepEqual(rows, ["left  middle  right"]);
});

test("a slight vertical offset still counts as the same row", () => {
  // The figure's box rarely aligns to the pixel with the label's.
  const rows = rowsFromLines([at("Summe", 160, 10, 20), at("24,90", 166, 220, 20)]);
  assert.deepEqual(rows, ["Summe  24,90"]);
});

test("a full line's gap is a new row", () => {
  const rows = rowsFromLines([at("Summe", 160, 10, 20), at("24,90", 190, 220, 20)]);
  assert.deepEqual(rows, ["Summe", "24,90"]);
});

test("the threshold scales with the image, not with a fixed number of pixels", () => {
  // The same receipt photographed closer: every box is five times taller, and
  // the same pairs must still group. A fixed tolerance would split these.
  const rows = rowsFromLines([at("Summe", 800, 50, 100), at("24,90", 830, 1100, 100)]);
  assert.deepEqual(rows, ["Summe  24,90"]);
});

test("a tilted photo does not split a row halfway along", () => {
  // Each box sits a little lower than the last; the row's own centre follows.
  const rows = rowsFromLines([
    at("A", 100, 10, 20),
    at("B", 104, 120, 20),
    at("C", 108, 230, 20),
    at("D", 112, 340, 20),
  ]);
  assert.deepEqual(rows, ["A  B  C  D"]);
});

test("empty text is dropped, not turned into an empty row", () => {
  const rows = rowsFromLines([at("Summe", 100, 10), at("   ", 100, 200), at("24,90", 100, 400)]);
  assert.deepEqual(rows, ["Summe  24,90"]);
});

test("no frames at all: the engine's own order is kept", () => {
  const rows = rowsFromLines([{ text: "Summe" }, { text: "24,90" }]);
  assert.deepEqual(rows, ["Summe", "24,90"]);
});

test("a PARTLY framed page falls back whole, rather than half-placing it", () => {
  // Scoring against rows that are only partly real is worse than not placing
  // them: the rules would trust a layout that was never measured.
  const rows = rowsFromLines([at("Summe", 100, 10), { text: "24,90" }]);
  assert.deepEqual(rows, ["Summe", "24,90"]);
});

test("nothing in, nothing out", () => {
  assert.deepEqual(rowsFromLines([]), []);
  assert.deepEqual(rowsFromLines([{ text: "  " }]), []);
});

test("every line the engine returned appears exactly once", () => {
  const input = [at("a", 100, 10), at("b", 100, 200), at("c", 140, 10), at("d", 180, 60)];
  const joined = rowsFromLines(input).join(" ");
  for (const { text } of input) {
    const hits = joined.split(text).length - 1;
    assert.equal(hits, 1, `"${text}" appeared ${hits} times`);
  }
});
