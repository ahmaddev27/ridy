import assert from "node:assert/strict";
import { test } from "node:test";

const { amountLabel, cleanText } = await import("../src/lib/submission-detail.ts");

test("an amount is German-formatted, with Latin digits", () => {
  assert.match(amountLabel("41.47"), /^41,47\s€$/);
  assert.match(amountLabel("1234.5"), /^1\.234,50\s€$/);
});

test("an amount that is not the wire shape is not shown at all", () => {
  for (const bad of [null, undefined, "", "abc", "1,5", "1.234.5", "-3", "12.345"]) {
    assert.equal(amountLabel(bad), null, String(bad));
  }
});

test("blank text is nothing", () => {
  assert.equal(cleanText("  "), null);
  assert.equal(cleanText(undefined), null);
  assert.equal(cleanText(" hi "), "hi");
});

const { decimalLabel, kmLabel, dayLabel, clockLabel, instantLabel } = await import("../src/lib/submission-detail.ts");

test("litres and unit price keep their places, with Latin digits", () => {
  assert.equal(decimalLabel("30.50", "l"), "30,5 l");
  assert.equal(decimalLabel("1.789", "€/l"), "1,789 €/l");
  assert.equal(decimalLabel("1,5", "l"), null);
  assert.equal(decimalLabel(null, "l"), null);
});

test("the odometer is whole kilometres", () => {
  assert.equal(kmLabel("25382"), "25.382 km");
  assert.equal(kmLabel("25382.5"), null);
  assert.equal(kmLabel(""), null);
});

test("a receipt date is not shifted by the timezone, in Arabic too", () => {
  assert.match(dayLabel("2026-10-07", "de-DE"), /^07\. Oktober 2026$/);
  assert.match(dayLabel("2026-10-07", "ar-u-nu-latn"), /^07 .+ 2026$/);
  assert.equal(dayLabel("2026-02-31", "de-DE"), null);
  assert.equal(dayLabel("07.10.2026", "de-DE"), null);
});

test("clock times are 24-hour or nothing", () => {
  assert.equal(clockLabel("08:15"), "08:15");
  assert.equal(clockLabel("8:15"), null);
  assert.equal(clockLabel("24:00"), null);
});

test("an instant is shown in Berlin time with Latin digits", () => {
  assert.match(instantLabel("2026-10-07T06:15:00Z", "ar-u-nu-latn"), /08:15|8:15/);
  assert.equal(instantLabel("nope", "de-DE"), null);
});
