// Run with `npm test` (node --test; Node >= 23.6 strips the TypeScript types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fleetYmd, fleetDayKey, fleetDayRange, shiftYmd } from "../src/lib/fleet-day.ts";

test("a moment before 04:00 Berlin belongs to the previous fleet-day", () => {
  // 2026-09-24 02:30 Berlin (CEST, UTC+2) = 00:30Z
  assert.equal(fleetYmd(new Date("2026-09-24T00:30:00Z")), "2026-09-23");
  // 2026-09-24 04:00 Berlin = 02:00Z → the new fleet-day starts
  assert.equal(fleetYmd(new Date("2026-09-24T02:00:00Z")), "2026-09-24");
});

test("fleet-day follows Berlin, not the browser zone, across DST", () => {
  // Winter (CET, UTC+1): 03:59 Berlin = 02:59Z → previous day
  assert.equal(fleetDayKey("2026-01-10T02:59:00Z"), "2026-01-09");
  assert.equal(fleetDayKey("2026-01-10T03:00:00Z"), "2026-01-10");
});

test("yesterday is a single inclusive fleet-day label", () => {
  const ref = new Date("2026-09-23T10:00:00Z");
  assert.deepEqual(fleetDayRange(1, 1, ref), { from: "2026-09-22", to: "2026-09-22" });
  assert.deepEqual(fleetDayRange(1, 0, ref), { from: "2026-09-23", to: "2026-09-23" });
});

test("7d spans exactly 7 fleet-days ending today", () => {
  const ref = new Date("2026-09-23T10:00:00Z");
  assert.deepEqual(fleetDayRange(7, 0, ref), { from: "2026-09-17", to: "2026-09-23" });
  assert.deepEqual(fleetDayRange(30, 0, ref), { from: "2026-08-25", to: "2026-09-23" });
});

test("between 00:00 and 04:00 'today' is still the previous date", () => {
  const ref = new Date("2026-09-24T01:00:00Z"); // 03:00 Berlin
  assert.deepEqual(fleetDayRange(1, 0, ref), { from: "2026-09-23", to: "2026-09-23" });
});

test("shiftYmd crosses month and DST boundaries by calendar days", () => {
  assert.equal(shiftYmd("2026-03-29", -1), "2026-03-28");
  assert.equal(shiftYmd("2026-10-01", -1), "2026-09-30");
  assert.equal(shiftYmd("2026-12-31", 1), "2027-01-01");
});
