import assert from "node:assert/strict";
import { test } from "node:test";

const { groupSubmissions, mondayOf, shortDay } = await import("../src/lib/submission-groups.ts");

const at = (iso) => ({ id: iso, created_at: iso });

test("a week belongs to the month containing its Monday", () => {
  // 01.04.2026 is a Wednesday, so its week's Monday is 30.03 and the whole
  // week is MARCH's. This is El-Professor's rule and the reason this module
  // exists; getting it wrong makes the driver and his company disagree about
  // which month a receipt is in.
  const groups = groupSubmissions([at("2026-04-01T10:00:00Z"), at("2026-04-02T10:00:00Z")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].monthKey, "2026-03");
  assert.equal(groups[0].weeks[0].mondayIso, "2026-03-30");
  assert.equal(groups[0].weeks[0].sundayIso, "2026-04-05");
});

test("Sunday stays in its own week, not the next one", () => {
  // getDay() is 0 on Sunday. Treating that as "one day after Monday" moves
  // every Sunday forward a week, which no test would notice on a weekday.
  const sunday = new Date(2026, 9, 11); // 11.10.2026 is a Sunday
  assert.equal(mondayOf(sunday).getDate(), 5);
  assert.equal(mondayOf(sunday).getMonth(), 9);
});

test("weeks are numbered from 1 in calendar order, newest first on screen", () => {
  const groups = groupSubmissions([
    at("2026-09-02T09:00:00"), // week of Mon 31.08 -> August
    at("2026-09-08T09:00:00"), // week of Mon 07.09 -> week 1 of September
    at("2026-09-15T09:00:00"), // week of Mon 14.09 -> week 2
    at("2026-09-23T09:00:00"), // week of Mon 21.09 -> week 3
  ]);
  const sept = groups.find((g) => g.monthKey === "2026-09");
  assert.ok(sept);
  // Newest first for reading...
  assert.deepEqual(sept.weeks.map((w) => w.weekNo), [3, 2, 1]);
  // ...but the NUMBER is calendar order, so week 1 is the month's first week.
  assert.equal(sept.weeks.at(-1).mondayIso, "2026-09-07");
  assert.equal(sept.count, 3);
  // And 02.09 went to August, because its Monday did.
  assert.ok(groups.some((g) => g.monthKey === "2026-08"));
});

test("months come newest first", () => {
  const groups = groupSubmissions([
    at("2026-08-12T09:00:00"),
    at("2026-10-07T09:00:00"),
    at("2026-09-09T09:00:00"),
  ]);
  assert.deepEqual(groups.map((g) => g.monthKey), ["2026-10", "2026-09", "2026-08"]);
});

test("items inside a week come newest first", () => {
  const groups = groupSubmissions([
    at("2026-10-06T08:00:00"),
    at("2026-10-08T08:00:00"),
    at("2026-10-07T08:00:00"),
  ]);
  assert.deepEqual(
    groups[0].weeks[0].items.map((i) => i.id),
    ["2026-10-08T08:00:00", "2026-10-07T08:00:00", "2026-10-06T08:00:00"],
  );
});

test("a row with no date is kept, not dropped", () => {
  // It is something the driver sent. A list that silently loses an entry is
  // worse than one with an entry in an odd place.
  const groups = groupSubmissions([
    { id: "a", created_at: null },
    { id: "b", created_at: "not a date" },
    at("2026-10-07T09:00:00"),
  ]);
  const orphans = groups.find((g) => g.monthKey === "");
  assert.ok(orphans);
  assert.deepEqual(orphans.weeks[0].items.map((i) => i.id), ["a", "b"]);
  // And it sorts last, so it never pushes a real month off the top.
  assert.equal(groups.at(-1).monthKey, "");
});

test("an empty list is an empty list, not a group of nothing", () => {
  assert.deepEqual(groupSubmissions([]), []);
});

test("a year boundary does not merge December into January", () => {
  const groups = groupSubmissions([at("2025-12-30T09:00:00"), at("2026-01-06T09:00:00")]);
  // 30.12.2025 is a Tuesday -> Monday 29.12 -> December 2025.
  // 06.01.2026 is a Tuesday -> Monday 05.01 -> January 2026.
  assert.deepEqual(groups.map((g) => g.monthKey), ["2026-01", "2025-12"]);
});

test("shortDay prints day then month, never the US order", () => {
  assert.equal(shortDay("2026-10-13"), "13.10");
});
