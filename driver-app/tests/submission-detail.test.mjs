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
