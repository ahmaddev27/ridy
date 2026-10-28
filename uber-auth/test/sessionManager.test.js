import { test } from "node:test";
import assert from "node:assert/strict";

import { PersistentSessionManager, SESSION_STATE } from "../src/sessionManager.js";

// A fake clock so "due" and expiry logic is deterministic.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

// A scripted driver: each keepWarm() call shifts the next queued result.
function fakeDriver(results = []) {
  const calls = [];
  const closed = [];
  return {
    calls,
    closed,
    async keepWarm(entry) {
      calls.push(entry.companyKey);
      return results.length ? results.shift() : { ok: true, cookies: [{ name: "sid", value: "fresh" }] };
    },
    async close(entry) {
      closed.push(entry.companyKey);
    },
  };
}

function manager(driver, extra = {}) {
  const posted = [];
  const notified = [];
  const clk = clock();
  const m = new PersistentSessionManager({
    driver,
    post: async (k, cap) => posted.push({ k, cap }),
    notify: async (k, reason) => notified.push({ k, reason }),
    now: clk.now,
    ...extra,
  });
  return { m, posted, notified, clk };
}

test("adopt registers an active session shown in status", async () => {
  const { m } = manager(fakeDriver());
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-abcdef12", tokenExpiries: { supplier: 2_000_000 } });
  const s = m.status();
  assert.equal(s.length, 1);
  assert.equal(s[0].state, SESSION_STATE.ACTIVE);
  assert.equal(s[0].org, "org-abcd");
  assert.equal(s[0].token_expiries.supplier, 2_000_000);
});

test("a due keep-warm captures fresh cookies and forwards them to the backend", async () => {
  const driver = fakeDriver([{ ok: true, cookies: [{ name: "sid", value: "v2" }], tokenExpiries: { supplier: 9_000_000 } }]);
  const { m, posted, clk } = manager(driver, { renewIntervalMs: 1000 });
  await m.adopt("acme", { id: 1 });
  clk.advance(1500); // now past the renew interval
  await m.tick();
  assert.deepEqual(driver.calls, ["acme"]);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].cap.cookies[0].value, "v2");
  assert.equal(m.get("acme").tokenExpiries.supplier, 9_000_000);
});

test("not-yet-due sessions are skipped", async () => {
  const driver = fakeDriver();
  const { m } = manager(driver, { renewIntervalMs: 60_000 });
  await m.adopt("acme", { id: 1 });
  await m.tick(); // no time passed -> not due
  assert.equal(driver.calls.length, 0);
});

test("a near-expiry token forces an early keep-warm before the interval", async () => {
  const driver = fakeDriver();
  const { m, clk } = manager(driver, { renewIntervalMs: 60 * 60 * 1000, renewBeforeExpiryMs: 12 * 60 * 60 * 1000 });
  // supplier token expires in 6h — inside the 12h early-renew window.
  await m.adopt("acme", { id: 1 }, { tokenExpiries: { supplier: clk.now() + 6 * 60 * 60 * 1000 } });
  await m.tick(); // interval not elapsed, but expiry is near -> due
  assert.deepEqual(driver.calls, ["acme"]);
});

test("Uber signing the browser out moves it to needs_otp, notifies, and does NOT post", async () => {
  const driver = fakeDriver([{ ok: true, loggedOut: true }]);
  const { m, posted, notified, clk } = manager(driver, { renewIntervalMs: 1 });
  await m.adopt("acme", { id: 1 });
  clk.advance(10);
  await m.tick();
  assert.equal(m.get("acme").state, SESSION_STATE.NEEDS_OTP);
  assert.equal(m.get("acme").hard_reauth_count ?? m.get("acme").hardReauthCount, 1);
  assert.deepEqual(notified, [{ k: "acme", reason: "needs_otp" }]);
  assert.equal(posted.length, 0, "a signed-out capture is never forwarded");
});

test("repeated keep-warm errors flip the session to down and close the context", async () => {
  const driver = fakeDriver([
    { ok: false, error: "nav timeout" },
    { ok: false, error: "nav timeout" },
    { ok: false, error: "nav timeout" },
  ]);
  const { m, clk } = manager(driver, { renewIntervalMs: 1, errorsBeforeDown: 3 });
  await m.adopt("acme", { id: 1 });
  for (let i = 0; i < 3; i++) {
    clk.advance(10);
    await m.tick();
  }
  assert.equal(m.get("acme").state, SESSION_STATE.DOWN);
  assert.deepEqual(driver.closed, ["acme"]);
});

test("adopt refuses a brand-new company once at capacity, but re-adopting an existing one is fine", async () => {
  const { m } = manager(fakeDriver(), { maxSessions: 1 });
  await m.adopt("acme", { id: 1 });
  await assert.rejects(() => m.adopt("other", { id: 2 }), /at_capacity/);
  // Re-adopting the same company (a re-login) must still work.
  await m.adopt("acme", { id: 3 });
  assert.equal(m.liveCount(), 1);
});

test("down sessions do not count against capacity", async () => {
  const driver = fakeDriver([{ ok: false, error: "x" }]);
  const { m, clk } = manager(driver, { maxSessions: 1, renewIntervalMs: 1, errorsBeforeDown: 1 });
  await m.adopt("acme", { id: 1 });
  clk.advance(10);
  await m.tick(); // acme -> down
  assert.equal(m.get("acme").state, SESSION_STATE.DOWN);
  await m.adopt("other", { id: 2 }); // capacity freed by the down session
  assert.equal(m.get("other").state, SESSION_STATE.ACTIVE);
});
