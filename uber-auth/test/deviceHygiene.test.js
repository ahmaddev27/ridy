import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRow, parseRowText, runHygiene, ACTION, STATUS, DEFAULT_CTX } from "../src/deviceHygiene.js";

const row = (text) => parseRowText(text);
const OWNER_WIN = "Chrome on Windows\nFrankfurt, Germany\n3 days ago";
const STALE_LINUX = "Chrome on Linux\nFrankfurt, Germany\n5 days ago";
const CURRENT = (marker) => `Chrome on Linux\nFrankfurt, Germany\n${marker}`;

test("owner's Chrome on Windows row is skipped", () => {
  assert.equal(classifyRow(row(OWNER_WIN), DEFAULT_CTX).action, ACTION.SKIP);
});

test("current-login row is protected in DE, EN and AR", () => {
  for (const m of ["Your current login", "Aktuelle Anmeldung", "تسجيل الدخول الحالي"]) {
    assert.equal(classifyRow(row(CURRENT(m)), DEFAULT_CTX).action, ACTION.PROTECT, m);
  }
});

test("stale Chrome on Linux row would be signed out", () => {
  assert.equal(classifyRow(row(STALE_LINUX), DEFAULT_CTX).action, ACTION.WOULD_SIGNOUT);
});

test("recently active or unknown-platform rows are skipped", () => {
  assert.equal(classifyRow(row("Chrome on Linux\nFrankfurt, Germany\n5 minutes ago"), DEFAULT_CTX).action, ACTION.SKIP);
  assert.equal(classifyRow(row("Safari on iPhone\nBerlin, Germany\n9 days ago"), DEFAULT_CTX).action, ACTION.SKIP);
});

test("region allowlist narrows would-signout", () => {
  const ctx = { ...DEFAULT_CTX, regions: ["Hamburg"] };
  assert.equal(classifyRow(row(STALE_LINUX), ctx).action, ACTION.SKIP);
});

test("runHygiene classifies when a current marker exists and never touches the page", async () => {
  const rows = [row(CURRENT("Your current login")), row(OWNER_WIN), row(STALE_LINUX)];
  const page = new Proxy({}, { get: () => { throw new Error("page must not be touched"); } });
  const r = await runHygiene(page, { parse: async () => rows });
  assert.equal(r.status, STATUS.DONE);
  assert.equal(r.wouldSignout.length, 1);
  assert.equal(r.protected.length, 1);
  assert.equal(r.skipped.length, 1);
});

test("runHygiene ABORTS when no row carries the current-login marker", async () => {
  const logs = [];
  const r = await runHygiene({}, { parse: async () => [row(OWNER_WIN), row(STALE_LINUX)], log: (m) => logs.push(m) });
  assert.equal(r.status, STATUS.ABORT_NO_CURRENT_MARKER);
  assert.ok(logs.some((m) => m.includes("ABORT")));
});

test("runHygiene aborts on a login redirect and never throws", async () => {
  const e = Object.assign(new Error("not_authenticated"), { code: STATUS.ABORT_NOT_AUTHENTICATED });
  assert.equal((await runHygiene({}, { parse: async () => { throw e; } })).status, STATUS.ABORT_NOT_AUTHENTICATED);
  assert.equal((await runHygiene({}, { parse: async () => { throw new Error("x"); } })).status, STATUS.ERROR);
});
