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

test("invoice over a thousand euros: no receipt number rather than a word", () => {
  // Fixed deliberately on 27.10.2026: `Beleg` now requires a word boundary, so
  // `Belegdatum` no longer yields the word "datum" as a number. No number on
  // this invoice means none is reported.
  assert.equal(parseReceiptText(BIG).receiptNumber, undefined);
});

// ── The JET Hagen receipt, 20.10.2026 ────────────────────────────────────────
//
// A real receipt that exposed four misreadings at once (errors/ in the repo):
// the TSE Anmeldezeit (08:46:19) was reported as the sale time instead of the
// printed `Datum Zeit` 08:45; `Summe Netto` outscored `Summe` through the
// position bonus and 34,52 was reported as the total with full confidence;
// the printed Bon number (90521) was not read at all; and on a tilted photo
// the city came out as "Hagen Tei.Nr." and the merchant as the street plus
// the garbled name. Values asserted here are what the PAPER prints — the
// fixture is the receipt, not the bug.

/** The rows as printed: name, street, PLZ, contact block, items, totals,
 *  TSE block, and the columnar `Datum Zeit Bon` trailer. */
const JET = `JET Tankstelle Morten Jürgensmeier
Eckeseyer Straße 113-115
58089 Hagen
Tel.Nr. 0 23 31- 2 24 88
Fax.Nr.0 23 31-92 45 07
Steuer-Nr. 321/5125/2808
www.JET.de
* 19,95 Liter #  08 *  EUR  41,08*A
Super E10
2,059 EUR / Liter
Z-Summe  EUR  41,08
19,00 % MWST. A  EUR  6,56
Summe  EUR  41,08
Bar Indoor  EUR  41,08
19,00 % MWST. A  EUR  6,56
Summe Netto  EUR  34,52
POS S/N: NAMOS-4314-002
TSE S/N: B81779BAB235100F610722F9D42C171
Transaktionsnummer: 1142170
Anmeldezeit (Start): 20.10.2026 08:46:19
Anmeldezeit (Ende): 20.10.2026 08:46:19
Signaturzähler: 2659248
Datum  Zeit  Bon  POS KNo Schicht
20.10.26  08:45  90521  02 0005  848
Wir bedanken uns für Ihren Einkauf und w`;

/** The same receipt as a tilted photo yields it: the first two rows merged
 *  left-first, the PLZ row merged with the Tel row, OCR misreads kept. */
const JET_TILTED = `Eckeseyer Straße 113-115  JET Tankstel le Morten Jtirgensmeier
58089 Hagen  Tei.Nr. 0 23 31- 2 24 88
Fax.Nr.0 23 31-92 45 07
Steuer-Nr. 321/5125/2808
www.JET.de
* 19,95 Liter #  08 *  EUR  41,08*A
Super E10
2,059 EUR / Liter
Z-Summe  EUR  41,08
19,00 % MWST. A  EUR  6,56
Summe  EUR  41,08
Bar Indoor  EUR  41,08
19,00 % MWST. A  EUR  6,56
Summe Netto  EUR  34,52
Transaktionsnummer: 1142170
Anmeldezeit (Start): 20.10.2026 08:46:19
Anmeldezeit (Ende): 20.10.2026 08:46:19
Datum  Zeit  Bon  POS KNo Schicht
20.10.26  08:45  90521  02 0005  848
Wir bedanken uns für Ihren Einkauf und w`;

test("JET: the printed sale time, not the TSE Anmeldezeit", () => {
  const r = parseReceiptText(JET);
  assert.equal(r.time, "08:45");
  assert.equal(r.tseTime, "08:46:19");
  assert.equal(r.date, "2026-10-20");
});

test("JET: the Summe, never the Summe Netto, the MWST or the tendered cash", () => {
  assert.equal(parseReceiptText(JET).amount, 41.08);
});

test("JET: the printed Bon number from the columnar trailer", () => {
  assert.equal(parseReceiptText(JET).bonNumber, "90521");
});

test("JET: station, operator and street as separate fields, umlauts intact", () => {
  const r = parseReceiptText(JET);
  assert.equal(r.merchantName, "JET Tankstelle Morten Jürgensmeier");
  assert.equal(r.stationName, "JET Tankstelle");
  assert.equal(r.operatorName, "Morten Jürgensmeier");
  assert.equal(r.street, "Eckeseyer Straße 113-115");
  assert.equal(r.postalCode, "58089");
  assert.equal(r.city, "Hagen");
});

test("JET: fuel figures with the third decimal, and the product confirms the total", () => {
  const r = parseReceiptText(JET);
  assert.equal(r.litres, 19.95);
  assert.equal(r.pricePerLitre, 2.059);
  // 19,95 × 2,059 = 41,077 ≈ the printed 41,08, so the total is confirmed
  // rather than flagged.
  assert.equal(r.amountReason?.startsWith("Unsicher"), false);
});

test("JET tilted: the city is not the phone number", () => {
  const r = parseReceiptText(JET_TILTED);
  assert.equal(r.city, "Hagen");
  assert.equal(r.postalCode, "58089");
});

test("JET tilted: the street does not contaminate the merchant", () => {
  const r = parseReceiptText(JET_TILTED);
  assert.equal(r.street, "Eckeseyer Straße 113-115");
  assert.equal(r.merchantName?.includes("Straße"), false);
  assert.equal(r.merchantName?.includes("113"), false);
});

test("JET tilted: sale time and total survive the tilt", () => {
  const r = parseReceiptText(JET_TILTED);
  assert.equal(r.time, "08:45");
  assert.equal(r.amount, 41.08);
});

// ── Guard rails the JET case exposed, as their own minimal fixtures ─────────

test("Summe Netto never beats a labelled total, whatever its position", () => {
  const r = parseReceiptText(`Tankstelle Test
Gesamtbetrag  EUR  50,00
19,00 % MWST  EUR  7,98
Summe Netto  EUR  42,02`);
  assert.equal(r.amount, 50);
});

test("a total below litres times price is flagged for review, not replaced", () => {
  // 30 l × 1,80 = 54,00, yet the only total line says 42,02: on a fuel
  // receipt the total cannot undercut the fuel line alone, so the figure is
  // kept (discounts exist) but marked for the driver to confirm.
  const r = parseReceiptText(`Tankstelle Test
Diesel
30,00 Liter
1,800 EUR / Liter
Gesamtbetrag  EUR  42,02`);
  assert.equal(r.amount, 42.02);
  assert.equal(r.amountReason?.startsWith("Unsicher"), true);
});

test("ARAL fixture: street and station read from the header", () => {
  const r = parseReceiptText(FUEL);
  assert.equal(r.street, "Hauptstrasse 12");
  assert.equal(r.stationName, "ARAL Tankstelle");
  assert.equal(r.operatorName, undefined);
});

// ── Station-header hygiene, 29.10.2026 ──────────────────────────────────────
//
// Four misreadings off one production screenshot: `Esso)` with a stray
// bracket, `Sol ingen` as the city, `JET TANKSTELLE 318` with the branch
// number glued into the name, and `JET Tankstel le …` where the OCR space
// inside the station word defeated the split entirely. General rules, no
// sample values hard-coded: the fixtures are shapes, not that screenshot.

test("an unbalanced bracket around the name is stripped, the city is healed", () => {
  const r = parseReceiptText(`Esso)
Hauptstraße 5
42651 Sol ingen
Summe  EUR  20,00`);
  assert.equal(r.merchantName, "Esso");
  // "ingen" starts lowercase and is no connector word, so it continues the
  // word before it. The PLZ stays untouched beside it.
  assert.equal(r.city, "Solingen");
  assert.equal(r.postalCode, "42651");
});

test("balanced brackets are part of the name and stay", () => {
  const r = parseReceiptText(`Tank (24h) Center GmbH
Industriestraße 2
44787 Bochum
Summe  EUR  15,00`);
  assert.equal(r.merchantName, "Tank (24h) Center GmbH");
});

test("real multi-word cities are not glued together", () => {
  const frankfurt = parseReceiptText(`Waschpark Mitte
Mainzer Landstraße 50
60311 Frankfurt am Main
Summe  EUR  10,00`);
  assert.equal(frankfurt.city, "Frankfurt am Main");
  const bergisch = parseReceiptText(`Autohaus Nord
Kölner Straße 100
51465 Bergisch Gladbach
Summe  EUR  12,00`);
  assert.equal(bergisch.city, "Bergisch Gladbach");
});

test("JET tilted: the split station word is recognised, the operator kept as read", () => {
  // `Tankstel le` is the OCR's space, not two words. The keyword itself is
  // repaired — it is a recognised vocabulary word — but the operator's NAME
  // is kept exactly as read (`Jtirgensmeier`): a person's spelling is never
  // guessed without the paper.
  const r = parseReceiptText(JET_TILTED);
  assert.equal(r.stationName, "JET Tankstelle");
  assert.equal(r.operatorName, "Morten Jtirgensmeier");
});

test("a branch number after the station word is its own field, not a name part", () => {
  const r = parseReceiptText(`JET TANKSTELLE 318
Kölner Str. 8
42651 Solingen
Summe  EUR  30,00`);
  assert.equal(r.stationName, "JET TANKSTELLE");
  assert.equal(r.stationNumber, "318");
  // The full printed line survives untouched beside the split.
  assert.equal(r.merchantName, "JET TANKSTELLE 318");
  // A branch number before the operator leaves the operator intact.
  const withOperator = parseReceiptText(`ARAL Station 77 Hans Meier
Bahnhofstraße 1
50667 Köln
Summe  EUR  25,00`);
  assert.equal(withOperator.stationName, "ARAL Station");
  assert.equal(withOperator.stationNumber, "77");
  assert.equal(withOperator.operatorName, "Hans Meier");
});

test("digits inside an ordinary merchant name are not a branch number", () => {
  const r = parseReceiptText(`Autoteile 24 GmbH
Bahnhofstraße 1
50667 Köln
Summe  EUR  9,99`);
  assert.equal(r.merchantName, "Autoteile 24 GmbH");
  assert.equal(r.stationNumber, undefined);
});

test("JET: no branch number is no field, not an empty one", () => {
  assert.equal(parseReceiptText(JET).stationNumber, undefined);
});

// ── The Shell Düsseldorf receipt, 29.10.2026 ────────────────────────────────
//
// A real long receipt (marketing tail, TSE block with `Start/Ende`, a labelled
// `Obj.-Nr.`). What it pins: the printed sale stamp 15:47 beside the Beleg-Nr
// wins over the TSE Start/Ende clock; the labelled object number is the
// station's own number; and the thermal misread of the litre unit (`l` → `1`)
// is readable when — and only when — the price-per-litre label anchors the
// same line. Values are what the PAPER prints.

const SHELL = `Shell Station
Goller Tankstellen GmbH
Niederrheinstr. 135
40474 Düsseldorf
Obj.-Nr.: 0000003708  Tel.: 0211/454791
Fax.: 0211/459582
Beleg-Nr. 3933/010/0002 28.09.2026 15:47
*U00002 Super FuelSave E16  50,00 EUR *A*
*Zp 02  21,94 l  2,279 EUR/l  *  *
Gesamtbetrag  50,00 EUR
gegeben  50,00 EUR
Typ  Netto  MwSt  Brutto
A:19,00%  42,02  7,98  50,00
Legende der Steuernummer(n)
# Gesellschaft  DE 811127597
DIENSTAG IST WASCHTAG !!!
Sparen Sie 1 EUR je Fahrzeugwäsche !!!
POS:68007-0000003708-2 TSE-Beleg-Nr. 336123
Signaturzähler: 359534
Start/Ende: 28.09.2026 16:47:26 / 28.09.2026 16:47:51`;

/** The same receipt with the litre unit and the price's `l` misread as `1` —
 *  the classic thermal-paper OCR failure that used to block the send. */
const SHELL_MISREAD = SHELL.replace(
  "*Zp 02  21,94 l  2,279 EUR/l  *  *",
  "*Zp 02  21,94 1  2,279 EUR/1  *  *",
);

test("Shell: the printed sale time, not the TSE Start/Ende clock", () => {
  const r = parseReceiptText(SHELL);
  assert.equal(r.date, "2026-09-28");
  assert.equal(r.time, "15:47");
  assert.equal(r.tseTime, "16:47:26");
});

test("Shell: the Gesamtbetrag, and the fuel figures confirm it", () => {
  const r = parseReceiptText(SHELL);
  assert.equal(r.amount, 50);
  assert.equal(r.litres, 21.94);
  assert.equal(r.pricePerLitre, 2.279);
  // 21,94 × 2,279 = 50,00 — confirmed, not flagged.
  assert.equal(r.amountReason?.startsWith("Unsicher"), false);
});

test("Shell: station, street, city, and the labelled Obj number", () => {
  const r = parseReceiptText(SHELL);
  assert.equal(r.stationName, "Shell Station");
  assert.equal(r.street, "Niederrheinstr. 135");
  assert.equal(r.postalCode, "40474");
  assert.equal(r.city, "Düsseldorf");
  assert.equal(r.stationNumber, "0000003708");
  assert.equal(r.receiptNumber, "3933/010/0002");
});

test("Shell misread: the fuel line with l read as 1 still parses, anchored", () => {
  const r = parseReceiptText(SHELL_MISREAD);
  assert.equal(r.pricePerLitre, 2.279);
  assert.equal(r.litres, 21.94);
  assert.equal(r.amount, 50);
});

test("a bare digit is never litres without the price anchor on its line", () => {
  // "1" after a number, no EUR/l anywhere: the misread rule must not fire.
  const r = parseReceiptText(`Tankstelle Test
Posten 23,50 1
Gesamtbetrag  EUR  23,50`);
  assert.equal(r.litres, undefined);
});

test("a labelled Tankstellen-Nr is the station number too", () => {
  const r = parseReceiptText(`Aral Tankstelle
Hauptstraße 1
40627 Düsseldorf
Tankstellen-Nr.: 0201099115
Summe  EUR  20,00`);
  assert.equal(r.stationNumber, "0201099115");
});

test("the number in the printed name wins over a labelled one", () => {
  const r = parseReceiptText(`JET TANKSTELLE 318
Kölner Str. 8
42651 Solingen
Tankstellen-Nr.: 999
Summe  EUR  30,00`);
  assert.equal(r.stationNumber, "318");
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
