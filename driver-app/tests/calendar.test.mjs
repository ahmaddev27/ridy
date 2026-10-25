// The note pickers' date arithmetic. The properties that matter: the week
// starts on MONDAY (it does everywhere else in this product), a local date is
// never shifted into UTC, and a date string that does not describe a real day
// is refused instead of silently rolling into the next month.

import { test } from "node:test";
import assert from "node:assert/strict";

const { pad, toDateValue, todayValue, fromDateValue, monthGrid, toTimeValue, fromTimeValue, splitNames } =
  await import("../src/lib/calendar.ts");

test("the grid is Monday-first, not Sunday-first", () => {
  // 1 Feb 2026 is a Sunday. Monday-first means SIX blanks before it; the
  // Sunday-first mistake would show none and shift the whole month a day.
  const feb = monthGrid(2026, 1);
  assert.deepEqual(feb.slice(0, 7), [null, null, null, null, null, null, 1]);

  // 1 Jun 2026 is a Monday: no leading blank at all.
  assert.equal(monthGrid(2026, 5)[0], 1);
});

test("a grid always fills whole weeks and holds every day exactly once", () => {
  for (const [y, m, days] of [[2026, 0, 31], [2026, 1, 28], [2024, 1, 29], [2026, 3, 30]]) {
    const cells = monthGrid(y, m);
    assert.equal(cells.length % 7, 0, `${y}-${m + 1} is not whole weeks`);
    const numbers = cells.filter((d) => d !== null);
    assert.equal(numbers.length, days, `${y}-${m + 1} day count`);
    assert.deepEqual(numbers, Array.from({ length: days }, (_, i) => i + 1));
  }
});

test("February gains a day in a leap year", () => {
  assert.equal(monthGrid(2024, 1).filter((d) => d !== null).length, 29);
  assert.equal(monthGrid(2026, 1).filter((d) => d !== null).length, 28);
});

test("a local date is never shifted into UTC", () => {
  // 01:00 Berlin on 7 October is still the 7th. toISOString() would make it
  // the 6th for any zone ahead of UTC, dating the note to the day before.
  assert.equal(toDateValue(new Date(2026, 9, 7, 1, 0, 0)), "2026-10-07");
  // And the last hour of a day stays on that day.
  assert.equal(toDateValue(new Date(2026, 9, 7, 23, 59, 59)), "2026-10-07");
  assert.equal(todayValue(new Date(2026, 0, 3)), "2026-01-03");
});

test("single-digit months and days are padded, never '2026-1-3'", () => {
  assert.equal(toDateValue(new Date(2026, 0, 3)), "2026-01-03");
  assert.equal(pad(7), "07");
  assert.equal(pad(23), "23");
});

test("a date that does not exist falls back instead of rolling over", () => {
  const fallback = new Date(2026, 5, 15);
  // new Date(2026, 1, 31) silently becomes 3 March — showing the driver a
  // different day than the one stored.
  assert.equal(toDateValue(fromDateValue("2026-02-31", fallback)), "2026-06-15");
  assert.equal(toDateValue(fromDateValue("2026-13-01", fallback)), "2026-06-15");
  assert.equal(toDateValue(fromDateValue("", fallback)), "2026-06-15");
  assert.equal(toDateValue(fromDateValue("07.10.2026", fallback)), "2026-06-15");
});

test("a real date round-trips through parse and format", () => {
  for (const v of ["2026-10-07", "2024-02-29", "2026-01-01", "2026-12-31"]) {
    assert.equal(toDateValue(fromDateValue(v)), v);
  }
});

test("times round-trip and a 24h-invalid time is refused", () => {
  assert.equal(toTimeValue(8, 0), "08:00");
  assert.equal(toTimeValue(23, 55), "23:55");
  // No hour means no time at all, not midnight.
  assert.equal(toTimeValue(null, 30), "");
  // An hour without a minute lands on the hour.
  assert.equal(toTimeValue(9, null), "09:00");

  assert.deepEqual(fromTimeValue("08:30"), { hour: 8, minute: 30 });
  for (const bad of ["25:00", "8:0", "", "0830", "24:00", "12:60"]) {
    assert.deepEqual(fromTimeValue(bad), { hour: null, minute: null }, bad);
  }
});

test("name lists are only used when the translation has the right count", () => {
  assert.equal(splitNames("Mo,Di,Mi,Do,Fr,Sa,So", 7).length, 7);
  assert.deepEqual(splitNames("Mo,Di,Mi", 7), [], "a short list must not render undefined");
  assert.deepEqual(splitNames("", 7), []);
  assert.equal(splitNames(" Mo , Di ,Mi,Do,Fr,Sa,So", 7)[1], "Di", "surrounding spaces are trimmed");
});
