// Unit tests for the app's pure date/format logic. Run with `npm test`
// (node --test; Node >= 22.18 strips the TypeScript types natively).
// The phone is deliberately NOT on German time: the fleet-day must follow the
// Europe/Berlin wall clock whatever the device time zone is.
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";

const { fleetNow } = await import("../src/lib/fleet-day.ts");
const { toAsciiDigits } = await import("../src/lib/format.ts");

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("before 04:00 Berlin belongs to the previous fleet-day", () => {
  // 03:59 Berlin (CEST, UTC+2) on 2026-09-24 = 01:59 UTC
  assert.equal(ymd(fleetNow(new Date("2026-09-24T01:59:00Z"))), "2026-09-23");
});

test("from 04:00 Berlin it is the new fleet-day", () => {
  // 04:00 Berlin (CEST) = 02:00 UTC
  assert.equal(ymd(fleetNow(new Date("2026-09-24T02:00:00Z"))), "2026-09-24");
});

test("DST end day: 04:30 wall clock is already the new day", () => {
  // 2026-10-25: clocks go back at 03:00 CEST -> 02:00 CET. 04:30 CET = 03:30 UTC.
  // Subtracting 4h of elapsed time used to land on 00:30 -> still the old day.
  assert.equal(ymd(fleetNow(new Date("2026-10-25T03:30:00Z"))), "2026-10-25");
});

test("DST start day: 03:30 wall clock is still the previous day", () => {
  // 2026-03-29: 02:00 CET -> 03:00 CEST. 03:30 CEST = 01:30 UTC.
  assert.equal(ymd(fleetNow(new Date("2026-03-29T01:30:00Z"))), "2026-03-28");
});

test("fleetNow is a noon anchor so date arithmetic stays off DST edges", () => {
  assert.equal(fleetNow(new Date("2026-09-24T10:00:00Z")).getHours(), 12);
});

test("Arabic-Indic and Persian digits become ASCII", () => {
  assert.equal(toAsciiDigits("١٢٣٤٥٦"), "123456");
  assert.equal(toAsciiDigits("۰۹۸"), "098");
  assert.equal(toAsciiDigits("Code: 12 34"), "Code: 12 34");
});

const { isFreshOffer, freshUntil } = await import("../src/lib/offer-freshness.ts");

test("an offer is fresh inside its accept window plus clock slack", () => {
  const offer = { received_at: "2026-09-24T10:00:00Z", accept_window_seconds: 15 };
  const received = Date.parse(offer.received_at);
  assert.equal(freshUntil(offer), received + 25_000);
  assert.equal(isFreshOffer(offer, received + 24_000), true);
  assert.equal(isFreshOffer(offer, received + 26_000), false);
});

test("a held pending offer (minutes old) is never fresh — Home must not show it as new", () => {
  const offer = { received_at: "2026-09-24T10:00:00Z", accept_window_seconds: 15 };
  assert.equal(isFreshOffer(offer, Date.parse(offer.received_at) + 10 * 60_000), false);
});

test("missing window falls back to 15s; missing receive time is never fresh", () => {
  const offer = { received_at: "2026-09-24T10:00:00Z", accept_window_seconds: null };
  assert.equal(freshUntil(offer), Date.parse(offer.received_at) + 25_000);
  assert.equal(isFreshOffer({ received_at: null, accept_window_seconds: 15 }), false);
});
