// Run with `npm test` (node --test; Node >= 23.6 strips the TypeScript types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { digitsOnly, formatMoney, formatNumber, latnLocale, toLatinDigits } from "../src/lib/utils.ts";

test("Arabic-Indic and Persian digits typed into code inputs become Latin", () => {
  assert.equal(toLatinDigits("٣"), "3");
  assert.equal(digitsOnly("١٢٣ ٤٥٦"), "123456");
  assert.equal(digitsOnly("۷۸۹"), "789");
  assert.equal(digitsOnly("12-34"), "1234");
});

test("latnLocale forces Latin digits for every locale", () => {
  assert.equal(latnLocale("ar"), "ar-u-nu-latn");
  assert.equal(latnLocale("de"), "de-u-nu-latn");
  assert.equal(latnLocale("ar-u-nu-latn"), "ar-u-nu-latn");
  assert.equal(latnLocale(""), "de-u-nu-latn");
});

test("money and numbers render Latin digits even in Arabic", () => {
  const ar = formatMoney(62595.12, "ar");
  assert.match(ar, /62[,.]?595[.,]12/);
  assert.doesNotMatch(ar, /[٠-٩]/);
  assert.match(formatMoney("7.5", "de"), /7,50\s?€/);
  assert.equal(formatMoney(null, "de"), "—");
  assert.doesNotMatch(formatNumber(1234567, "ar"), /[٠-٩]/);
});
