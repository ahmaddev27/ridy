// The receipt rules, measured against El-Professor's own fixtures.
//
// `src/lib/receipt-text-parse.ts` is a COPY of El-Professor's
// `src/utils/receiptTextParse.ts`, and this file is a copy of that module's
// test. Two repositories cannot compare their files, so what is compared is
// BEHAVIOUR: a change made on one side and not the other shows up here as a
// failing assertion rather than as a silent disagreement about what a receipt
// said.
//
// These are characterization tests, not specifications. Two recorded answers
// are nobody's design and are pinned rather than fixed, so that fixing either
// is a deliberate act with its own diff:
//
//   - the fuel receipt's amount is CORRECT (74,24, the Gesamtbetrag) and is
//     still marked `Unsicher`, because `mwst` on a nearby line costs it 80
//     points. That is exactly the case the driver's "confirm this field"
//     marker exists for.
//   - the workshop invoice reports a `receiptNumber` of 'datum' — the word.
//
// Do not update a failing expectation without reading why it moved. The amount
// a driver submits reaches their own balance.
//
// Run with `npm test` (node --test; Node >= 22.18 strips the types natively).

import { test } from "node:test";
import assert from "node:assert/strict";

const { parseReceiptText } = await import("../src/lib/receipt-text-parse.ts");

/** A fuel receipt: grouped lines, a tax line near the total, a time. */
const FUEL = `ARAL Tankstelle
Hauptstrasse 12
10115 Berlin
Datum 09.10.2026  Uhrzeit 14:32
Beleg-Nr 004711
Super E10
41,47 L   EUR/L 1,789
Netto        62,39
MwSt 19%     11,85
Gesamtbetrag  74,24
Bar gegeben   80,00
Rueckgeld      5,76`;

/** A car wash: one amount, one label, nothing to confuse it. */
const WASH = `Clean Car Autowaesche GmbH
Industrieweg 3
80331 Muenchen
Datum: 01.03.2026
Waesche Premium
Summe EUR 24,90`;

/** A workshop invoice over a thousand euros: the grouped-amount shape. */
const BIG = `KFZ Werkstatt Mueller
Ringstr. 8
50667 Koeln
Belegdatum 15.02.2026
Oel wechseln
Zu zahlen 2.480,00`;

test("fuel receipt: date, time and receipt number", () => {
  const r = parseReceiptText(FUEL);
  assert.equal(r.date, "2026-10-09");
  assert.equal(r.time, "14:32");
  assert.equal(r.receiptNumber, "004711");
});

test("fuel receipt: the Gesamtbetrag, not the cash given, the change or the tax", () => {
  assert.equal(parseReceiptText(FUEL).amount, 74.24);
});

test("fuel receipt: category and merchant", () => {
  const r = parseReceiptText(FUEL);
  assert.equal(r.category, "Tanken");
  assert.equal(r.merchantName, "ARAL Tankstelle");
});

test("fuel receipt: postal code and the city it resolves to", () => {
  const r = parseReceiptText(FUEL);
  assert.equal(r.postalCode, "10115");
  assert.equal(r.city, "Berlin");
});

test("fuel receipt: the amount is right and still marked uncertain", () => {
  // The tax line costs it 80 points, dropping it under the 50 the rules call
  // confident. The screen reads this exact prefix to decide what to highlight,
  // so the wording is data, not prose.
  const r = parseReceiptText(FUEL);
  assert.equal(r.amountConfidence, 45);
  assert.equal(
    r.amountReason,
    "Unsicher: +100 Label: Gesamtbetrag; -80 Ausschluss-Label: mwst",
  );
  assert.equal(r.dateConfidence, 100);
});

test("car wash: an unambiguous total, full confidence, no Unsicher prefix", () => {
  const r = parseReceiptText(WASH);
  assert.equal(r.amount, 24.9);
  assert.equal(r.amountConfidence, 100);
  assert.equal(r.amountReason, "+100 Label: Summe EUR; +70 EUR auf gleicher Zeile");
});

test("car wash: date, place and merchant", () => {
  const r = parseReceiptText(WASH);
  assert.equal(r.date, "2026-03-01");
  assert.equal(r.postalCode, "80331");
  assert.equal(r.city, "Muenchen");
  assert.equal(r.merchantName, "Clean Car Autowaesche GmbH");
});

test("car wash: no category rather than a guessed one", () => {
  // The stored vocabulary is 'Autowäsche' with an umlaut; this line has none,
  // which is what an OCR pass often produces. No category is the honest answer.
  assert.equal(parseReceiptText(WASH).category, undefined);
});

test("invoice over a thousand euros: the grouped amount is read whole", () => {
  const r = parseReceiptText(BIG);
  assert.equal(r.amount, 2480);
  assert.equal(r.amountConfidence, 100);
});

test("invoice over a thousand euros: date from a Belegdatum label", () => {
  assert.equal(parseReceiptText(BIG).date, "2026-02-15");
});

test('invoice over a thousand euros: reports the word "datum" as a receipt number', () => {
  // Recorded, not endorsed. This line is what fails when it is fixed.
  assert.equal(parseReceiptText(BIG).receiptNumber, "datum");
});

test("empty text answers an empty result rather than throwing", () => {
  const r = parseReceiptText("");
  assert.equal(r.amount, undefined);
  assert.equal(r.date, undefined);
});

test("text with no receipt in it at all", () => {
  const r = parseReceiptText("hello\nworld\n\n   \n");
  assert.equal(r.amount, undefined);
  assert.equal(r.date, undefined);
});
