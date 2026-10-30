import { test } from "node:test";
import assert from "node:assert/strict";

import { PersistentSessionManager, SESSION_STATE, jarFingerprint } from "../src/sessionManager.js";

// A fake clock so "due" and expiry logic is deterministic.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

// A scripted driver: each keepWarm() call shifts the next queued result.
function fakeDriver(results = []) {
  const calls = [];
  const optsSeen = [];
  const closed = [];
  return {
    calls,
    optsSeen,
    closed,
    async keepWarm(entry, opts) {
      calls.push(entry.companyKey);
      optsSeen.push(opts);
      return results.length ? results.shift() : { ok: true, orgVerified: true, cookies: [{ name: "sid", value: "fresh" }] };
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
  const driver = fakeDriver([{ ok: true, orgVerified: true, cookies: [{ name: "sid", value: "v2" }], tokenExpiries: { supplier: 9_000_000 } }]);
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

const HOUR = 60 * 60 * 1000;

test("isDue is strictly hourly: not at 59 min, due at 60", async () => {
  const { m, clk } = manager(fakeDriver());
  await m.adopt("acme", { id: 1 });
  clk.advance(59 * 60 * 1000);
  assert.equal(m.isDue(m.get("acme")), false);
  clk.advance(60 * 1000);
  assert.equal(m.isDue(m.get("acme")), true);
});

test("a near-expiry token never makes a session due early", async () => {
  const driver = fakeDriver();
  const { m, clk } = manager(driver);
  await m.adopt("acme", { id: 1 }, { tokenExpiries: { ramen: clk.now() + 60_000, supplier: clk.now() - 1 } });
  clk.advance(5 * 60 * 1000);
  await m.tick();
  assert.equal(driver.calls.length, 0);
});

test("posts iff the captured jar differs from the injected backend jar", async () => {
  const same = { ok: true, orgVerified: true, cookies: [{ name: "a", value: "1" }], supplierCookies: [{ name: "s", value: "1" }] };
  const driver = fakeDriver([same, { ...same, cookies: [{ name: "a", value: "2" }] }, { ...same, cookies: [{ name: "a", value: "2" }] }]);
  const { m, posted, clk } = manager(driver, { renewIntervalMs: HOUR });
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-1" });
  m.setBackendJar("acme", { cookies: [{ name: "a", value: "1" }], supplierCookies: [{ name: "s", value: "1" }] });
  for (let i = 0; i < 3; i++) {
    clk.advance(HOUR);
    await m.tick();
  }
  assert.equal(posted.length, 1, "identical jar: no post; rotated jar: one post; then it is the new base");
  assert.equal(posted[0].cap.cookies[0].value, "2");
});

test("jarFingerprint ignores order and tells RAMEN from supplier cookies", () => {
  const a = [{ name: "x", value: "1" }, { name: "y", value: "2" }];
  assert.equal(jarFingerprint(a, []), jarFingerprint([...a].reverse(), []));
  assert.notEqual(jarFingerprint(a, []), jarFingerprint([], a));
});

test("keep-warm is told to inject the backend jar, except in rescue mode", async () => {
  const driver = fakeDriver([warmResult(), warmResult()]);
  const { m, clk } = manager(driver, { renewIntervalMs: HOUR, rescueIntervalMs: 1000 });
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-1" });
  clk.advance(HOUR);
  await m.tick();
  m.setRescue("acme", true);
  clk.advance(1000);
  await m.tick();
  assert.deepEqual(driver.optsSeen, [{ inject: true }, { inject: false }]);
});

test("a first-known expiry (previously null) counts as a renewal", async () => {
  const driver = fakeDriver([{ ok: true, orgVerified: true, cookies: [{ name: "a", value: "1" }], tokenExpiries: { ramen: 7_000 } }]);
  const { m, posted, clk } = manager(driver, { renewIntervalMs: HOUR });
  await m.adopt("acme", { id: 1 });
  clk.advance(HOUR);
  await m.tick();
  assert.equal(posted.length, 1);
});

test("lastCaptureAt only advances after a post the backend accepted", async () => {
  const fwd = (n) => ({ ok: true, orgVerified: true, cookies: [{ name: "a", value: "x" }], tokenExpiries: { ramen: n } });
  const driver = fakeDriver([fwd(2_000), fwd(3_000), fwd(4_000)]);
  const outcomes = ["skipped", "blocked", "posted"];
  const clk = clock();
  const logs = [];
  const m = new PersistentSessionManager({ driver, post: async () => outcomes.shift(), now: clk.now, renewIntervalMs: HOUR, log: (l) => logs.push(l) });
  await m.adopt("acme", { id: 1 });
  const adoptedAt = m.get("acme").lastCaptureAt;
  clk.advance(HOUR);
  await m.tick();
  assert.equal(m.get("acme").lastCaptureAt, adoptedAt, "skipped is not captured");
  clk.advance(HOUR);
  await m.tick();
  assert.equal(m.get("acme").lastCaptureAt, adoptedAt, "blocked is not captured");
  clk.advance(HOUR);
  await m.tick();
  assert.equal(m.get("acme").lastCaptureAt, clk.now());
  assert.ok(logs.some((l) => l.includes("renewed: skipped")) && logs.some((l) => l.includes("renewed: blocked")));
});

test("a NEEDS_OTP entry is revived only when the wanted jar differs from the one it was seeded with", async () => {
  const { m } = manager(fakeDriver());
  await m.adopt("a", { id: 1 });
  m.setBackendJar("a", { cookies: [{ name: "c", value: "dead" }], supplierCookies: [] });
  m.get("a").state = SESSION_STATE.NEEDS_OTP;
  const dead = jarFingerprint([{ name: "c", value: "dead" }], []);
  assert.equal(await m.releaseIfDead("a", dead), null, "same dead jar: never");
  assert.equal(await m.releaseIfDead("a", null), null);
  assert.equal(await m.releaseIfDead("a", jarFingerprint([{ name: "c", value: "relinked" }], [])), SESSION_STATE.NEEDS_OTP);
  assert.equal(m.has("a"), false);
});

test("a NEEDS_OTP browser is re-seeded from a new jar at most every 5 minutes", async () => {
  const { m, clk } = manager(fakeDriver());
  const landOnLogin = async () => {
    await m.adopt("a", { id: 1 });
    m.setBackendJar("a", { cookies: [{ name: "c", value: "old" }], supplierCookies: [] });
    m.get("a").state = SESSION_STATE.NEEDS_OTP;
  };
  await landOnLogin();
  assert.equal(await m.releaseIfDead("a", jarFingerprint([{ name: "c", value: "rot-1" }], [])), SESSION_STATE.NEEDS_OTP);
  await landOnLogin();
  clk.advance(60 * 1000);
  assert.equal(await m.releaseIfDead("a", jarFingerprint([{ name: "c", value: "rot-2" }], [])), null, "a rotation a minute later waits");
  clk.advance(4 * 60 * 1000);
  assert.equal(await m.releaseIfDead("a", jarFingerprint([{ name: "c", value: "rot-3" }], [])), SESSION_STATE.NEEDS_OTP);
});

test("an active entry is never released", async () => {
  const { m } = manager(fakeDriver());
  await m.adopt("a", { id: 1 });
  assert.equal(await m.releaseIfDead("a", "whatever"), null);
});

test("a DOWN entry is revived at once, then backs off 1 -> 5 -> 15 min, and a post resets it", async () => {
  const { m, clk } = manager(fakeDriver());
  const dieAndTry = async (advanceMs) => {
    if (!m.has("a")) await m.adopt("a", { id: 1 });
    m.get("a").state = SESSION_STATE.DOWN;
    clk.advance(advanceMs);
    return m.releaseIfDead("a", "x");
  };
  assert.equal(await dieAndTry(0), SESSION_STATE.DOWN, "first: immediate");
  assert.equal(await dieAndTry(30_000), null, "30 s < 1 min");
  assert.equal(await dieAndTry(31_000), SESSION_STATE.DOWN, "61 s >= 1 min");
  assert.equal(await dieAndTry(4 * 60_000), null, "4 min < 5 min");
  assert.equal(await dieAndTry(61_000), SESSION_STATE.DOWN, "5 min reached");
  assert.equal(await dieAndTry(14 * 60_000), null, "14 min < 15 min");
  assert.equal(await dieAndTry(61_000), SESSION_STATE.DOWN, "15 min reached");
  assert.equal(await dieAndTry(10 * 60_000), null, "the cap stays 15 min");
  // A successful post resets the backoff.
  await m.adopt("a", { id: 2 }, { orgUuid: "org-1" });
  await m.renew("a"); // default fake result carries new cookies -> posted
  assert.equal(await dieAndTry(1), SESSION_STATE.DOWN, "reset: immediate again");
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

const warmResult = (extra = {}) => ({ ok: true, orgVerified: true, cookies: [{ name: "a", value: "x" }], tokenExpiries: { ramen: 5_000, supplier: 5_000 }, ...extra });

test("rescue posts a verified capture even when no expiry moved", async () => {
  const { m, posted, clk } = manager(fakeDriver([warmResult()]), { rescueIntervalMs: 1000 });
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-1", tokenExpiries: { ramen: 5_000, supplier: 5_000 } });
  m.get("acme").needsRescue = true;
  clk.advance(1000);
  await m.tick();
  assert.equal(posted.length, 1);
});

test("rescue still posts, under the known org, when the page did not show the org", async () => {
  const { m, posted, clk } = manager(fakeDriver([warmResult({ orgVerified: false, orgUuid: null })]), { rescueIntervalMs: 1000 });
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-1" });
  m.get("acme").needsRescue = true;
  clk.advance(1000);
  await m.tick();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].cap.orgUuid, "org-1");
});

test("a logged-out result in rescue mode goes to needs_otp", async () => {
  const { m, posted, clk } = manager(fakeDriver([{ ok: true, loggedOut: true }]), { rescueIntervalMs: 1000 });
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-1" });
  m.get("acme").needsRescue = true;
  clk.advance(1000);
  await m.tick();
  assert.equal(m.get("acme").state, SESSION_STATE.NEEDS_OTP);
  assert.equal(posted.length, 0);
});

test("a known org is never overwritten by a scraped one, a missing one is filled", async () => {
  const { m, clk } = manager(fakeDriver([warmResult({ orgUuid: "other" }), warmResult({ orgUuid: "filled" })]), { renewIntervalMs: HOUR });
  await m.adopt("known", { id: 1 }, { orgUuid: "org-1" });
  await m.adopt("blank", { id: 2 });
  clk.advance(HOUR);
  await m.tick();
  assert.equal(m.get("known").orgUuid, "org-1");
  assert.equal(m.get("blank").orgUuid, "filled");
});

test("isDue is 10 min in rescue mode, 60 min otherwise", async () => {
  const { m, clk } = manager(fakeDriver());
  await m.adopt("acme", { id: 1 });
  clk.advance(10 * 60 * 1000);
  assert.equal(m.isDue(m.get("acme")), false);
  m.get("acme").needsRescue = true;
  assert.equal(m.isDue(m.get("acme")), true);
});

test("outside rescue, a forward expiry is posted under the KNOWN org, whatever the page showed", async () => {
  const { m, posted, clk } = manager(
    fakeDriver([warmResult({ orgVerified: false, orgUuid: "someone-else", tokenExpiries: { ramen: 9_000 } })]),
    { renewIntervalMs: HOUR },
  );
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-1", tokenExpiries: { ramen: 5_000 } });
  clk.advance(HOUR);
  await m.tick();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].cap.orgUuid, "org-1");
});

test("rescue stops after 2 posts per episode, and a recovery resets the budget", async () => {
  const { m, posted, clk } = manager(fakeDriver([warmResult(), warmResult(), warmResult(), warmResult()]), { rescueIntervalMs: 1000, renewIntervalMs: HOUR });
  const logs = [];
  m.log = (l) => logs.push(l);
  await m.adopt("acme", { id: 1 }, { orgUuid: "org-1", tokenExpiries: { ramen: 5_000, supplier: 5_000 } });
  assert.equal(m.setRescue("acme", true), true);
  for (let i = 0; i < 2; i++) {
    clk.advance(1000);
    await m.tick();
  }
  assert.equal(posted.length, 2);
  assert.ok(logs.some((l) => l.includes("rescue: giving up after 2 attempts")));
  assert.equal(m.isDue(m.get("acme")), false, "back on the hourly cadence");
  clk.advance(HOUR);
  await m.tick();
  assert.equal(posted.length, 2, "normal rule: unchanged expiries are not posted");
  assert.equal(m.setRescue("acme", true), false, "still the same episode");
  m.setRescue("acme", false);
  assert.equal(m.setRescue("acme", true), true, "a new episode");
  clk.advance(1000);
  await m.tick();
  assert.equal(posted.length, 3);
});
