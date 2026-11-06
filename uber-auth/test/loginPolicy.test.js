import { test } from "node:test";
import assert from "node:assert/strict";

import { admitStart, companyMatches, createStartGate } from "../src/loginPolicy.js";
import { PersistentSessionManager, SESSION_STATE } from "../src/sessionManager.js";

const on = (state = null) => ({ passwordless: true, stateOf: () => state });
const off = { passwordless: false, stateOf: () => null };

test("passwordless start needs only email + company_key", () => {
  const r = admitStart({ email: "a@b.de", company_key: 7 }, on("needs_otp"));
  assert.deepEqual([r.ok, r.companyKey, r.password], [true, "7", null]);
});

test("without the passwordless flag the legacy password rule stays", () => {
  const r = admitStart({ email: "a@b.de", company_key: "7" }, off);
  assert.equal(r.ok, false);
  assert.equal(r.http, 422);
});

test("a passwordless start without company_key or email is refused", () => {
  assert.equal(admitStart({ email: "a@b.de" }, on()).http, 422);
  assert.equal(admitStart({ company_key: "7" }, on()).http, 422);
});

test("an ACTIVE session is never disturbed by a passwordless start", () => {
  const r = admitStart({ email: "a@b.de", company_key: "7" }, on(SESSION_STATE.ACTIVE));
  assert.equal(r.ok, false);
  assert.equal(r.http, 409);
  assert.equal(r.body.status, "session_active");
});

test("only a company with a warm context to ride (needs_otp / retry) may start", () => {
  assert.equal(admitStart({ email: "a@b.de", company_key: "7" }, on(SESSION_STATE.NEEDS_OTP)).ok, true);
  assert.equal(admitStart({ email: "a@b.de", company_key: "7" }, on(SESSION_STATE.LOGGING_IN)).ok, true);
});

test("a never-connected or dead company is a COLD login and is sent to the extension", () => {
  for (const state of [null, SESSION_STATE.DOWN, SESSION_STATE.NOT_SET_UP]) {
    const r = admitStart({ email: "a@b.de", company_key: "7" }, on(state));
    assert.equal(r.ok, false);
    assert.equal(r.body.status, "no_session");
  }
});

test("the legacy password flow is unchanged by the active guard", () => {
  assert.equal(admitStart({ email: "a@b.de", password: "x", company_key: "7" }, { passwordless: true, stateOf: () => "active" }).ok, true);
});

test("mfa is bound to the company that started the login", () => {
  assert.equal(companyMatches("7", "7"), true);
  assert.equal(companyMatches("7", 7), true);
  assert.equal(companyMatches("7", "8"), false);
  assert.equal(companyMatches("7", undefined), false);
  assert.equal(companyMatches(null, undefined), true);
});

function mgr() {
  return new PersistentSessionManager({ driver: { keepWarm: async () => ({ ok: true }) }, post: async () => "posted" });
}

test("markLoggingIn refuses an active session and leaves it warmable", async () => {
  const m = mgr();
  await m.adopt("7", {}, { orgUuid: "o" });
  assert.equal(m.markLoggingIn("7"), false);
  assert.equal(m.stateOf("7"), SESSION_STATE.ACTIVE);
});

test("markNeedsOtp only reverts a login in progress", async () => {
  const m = mgr();
  await m.adopt("7", {}, { orgUuid: "o" });
  m.markNeedsOtp("7");
  assert.equal(m.stateOf("7"), SESSION_STATE.ACTIVE);

  m.sessions.get("7").state = SESSION_STATE.NEEDS_OTP;
  assert.equal(m.markLoggingIn("7"), true);
  assert.equal(m.stateOf("7"), SESSION_STATE.LOGGING_IN);
  m.markNeedsOtp("7");
  assert.equal(m.stateOf("7"), SESSION_STATE.NEEDS_OTP);
});

test("markLoggingIn / markNeedsOtp on an unheld company are harmless no-ops", () => {
  const m = mgr();
  assert.equal(m.markLoggingIn("9"), true);
  m.markNeedsOtp("9");
  assert.equal(m.stateOf("9"), null);
});

test("a DOWN company that abandons a fresh re-link ends up DOWN again, not needs_otp", async () => {
  const m = mgr();
  await m.adopt("7", {}, { orgUuid: "o" });
  m.sessions.get("7").state = SESSION_STATE.DOWN;
  const gate = createStartGate({ markLoggingIn: (k) => m.markLoggingIn(k) });
  assert.equal(gate.enter("7").ok, true);
  assert.equal(m.stateOf("7"), SESSION_STATE.LOGGING_IN);
  m.markNeedsOtp("7");
  assert.equal(m.stateOf("7"), SESSION_STATE.DOWN);
  // a needs_otp company still lands on needs_otp
  m.sessions.get("7").state = SESSION_STATE.NEEDS_OTP;
  m.markLoggingIn("7");
  m.markNeedsOtp("7");
  assert.equal(m.stateOf("7"), SESSION_STATE.NEEDS_OTP);
});

test("start gate: an ACTIVE company is refused synchronously and never marked logging_in", async () => {
  const m = mgr();
  await m.adopt("7", {}, { orgUuid: "o" });
  const gate = createStartGate({ markLoggingIn: (k) => m.markLoggingIn(k) });
  const r = gate.enter("7");
  assert.equal(r.ok, false);
  assert.equal(r.http, 409);
  assert.equal(r.body.status, "session_active");
  assert.equal(m.stateOf("7"), SESSION_STATE.ACTIVE);
});

test("start gate: a second start while one is in flight is refused until it leaves", async () => {
  const m = mgr();
  await m.adopt("7", {}, { orgUuid: "o" });
  m.sessions.get("7").state = SESSION_STATE.NEEDS_OTP;
  const gate = createStartGate({ markLoggingIn: (k) => m.markLoggingIn(k) });
  assert.equal(gate.enter("7").ok, true);
  assert.equal(gate.enter("7").body.status, "start_in_flight");
  gate.leave("7");
  assert.equal(gate.enter("7").ok, true);
});

function capturing(post, keepWarm = async () => ({ ok: true, orgVerified: true, cookies: [{ name: "sid", value: "fresh" }] })) {
  return new PersistentSessionManager({ driver: { keepWarm }, post });
}

test("adoptAndCapture reports captured only when the backend accepted the post", async () => {
  const posts = [];
  const m = capturing(async (k) => (posts.push(k), "posted"));
  const out = await m.adoptAndCapture("7", {}, { orgUuid: "o", cookies: [{ name: "sid", value: "fresh" }] });
  assert.deepEqual(out, { captured: true });
  assert.equal(posts.length, 1, "posted even though the jar equals the login jar");
});

test("adoptAndCapture: a blocked post is NOT a capture", async () => {
  const m = capturing(async () => "blocked");
  const out = await m.adoptAndCapture("7", {}, { orgUuid: "o", cookies: [{ name: "sid", value: "x" }] });
  assert.deepEqual(out, { captured: false, reason: "blocked" });
});

test("adoptAndCapture: a failed keep-warm or a sign-out is NOT a capture", async () => {
  const failing = capturing(async () => "posted", async () => ({ ok: false, error: "boom" }));
  assert.equal((await failing.adoptAndCapture("7", {}, { orgUuid: "o", cookies: [] })).captured, false);

  const signedOut = capturing(async () => "posted", async () => ({ loggedOut: true }));
  const out = await signedOut.adoptAndCapture("7", {}, { orgUuid: "o", cookies: [] });
  assert.deepEqual(out, { captured: false, reason: "needs_otp" });
});

test("a fullLogin start needs no email (the manager types it in the stream); others still do", () => {
  const ctx = { passwordless: true, stateOf: () => null, coldEnabled: true };
  const full = admitStart({ company_key: "7", full: true, cold: true, proxy_url: "http://u:p@h:8080" }, ctx);
  assert.equal(full.ok, true);
  assert.equal(full.cold, true);
  // A non-full start with no email is still refused.
  assert.equal(admitStart({ company_key: "7", cold: true, proxy_url: "http://u:p@h:8080" }, ctx).http, 422);
});

test("canFullLogin needs full + co-browse preconditions + a fresh-browser start", async () => {
  const { canFullLogin } = await import("../src/loginPolicy.js");
  assert.equal(canFullLogin({ full: true, cobrowseOk: true, fresh: true }), true);
  for (const k of ["full", "cobrowseOk", "fresh"]) {
    assert.equal(canFullLogin({ full: true, cobrowseOk: true, fresh: true, [k]: false }), false, k);
  }
  assert.equal(canFullLogin({ full: undefined, cobrowseOk: true, fresh: true }), false);
});

const PROXY = "http://u:p@h:8080";
const fullBody = { company_key: "7", full: true, proxy_url: PROXY };

test("a full start for a warm-dead company (needs_otp / down / logging_in / nothing held) builds a FRESH browser", () => {
  for (const state of [SESSION_STATE.NEEDS_OTP, SESSION_STATE.DOWN, SESSION_STATE.LOGGING_IN, null]) {
    const r = admitStart(fullBody, { ...on(state), coldEnabled: false });
    assert.deepEqual([r.ok, r.fresh, r.cold], [true, true, false], String(state));
  }
});

test("a full start is refused for an ACTIVE session, cold flag or not", () => {
  for (const coldEnabled of [true, false]) {
    const r = admitStart({ ...fullBody, cold: true }, { ...on(SESSION_STATE.ACTIVE), coldEnabled });
    assert.deepEqual([r.ok, r.http, r.body.status], [false, 409, "session_active"]);
  }
});

test("a full start needs the proxy, and a claimed COLD one still needs the cold flag", () => {
  assert.equal(admitStart({ company_key: "7", full: true }, on(SESSION_STATE.NEEDS_OTP)).body.status, "no_proxy");
  assert.equal(admitStart({ ...fullBody, cold: true }, { ...on(null), coldEnabled: false }).body.status, "no_session");
  const cold = admitStart({ ...fullBody, cold: true }, { ...on(null), coldEnabled: true });
  assert.deepEqual([cold.ok, cold.cold, cold.fresh], [true, true, true]);
});

test("a non-full start is unchanged: a dead company is never given a fresh browser", () => {
  const r = admitStart({ email: "a@b.de", company_key: "7", proxy_url: PROXY }, { ...on(SESSION_STATE.DOWN), coldEnabled: true });
  assert.equal(r.ok, false);
  assert.equal(r.body.status, "no_session");
});

test("adoptGuard: a fresh login replaces a dead session but never an active one", async () => {
  const { adoptGuard, adoptMode } = await import("../src/loginPolicy.js");
  assert.equal(adoptMode({ cold: true, fresh: true }), "cold");
  assert.equal(adoptMode({ fresh: true }), "fresh");
  assert.equal(adoptMode({}), null);
  for (const dead of [SESSION_STATE.NEEDS_OTP, SESSION_STATE.DOWN, SESSION_STATE.LOGGING_IN]) {
    assert.deepEqual(adoptGuard("fresh", dead), { refuse: false, backend: "active" }, dead);
  }
  assert.deepEqual(adoptGuard("fresh", SESSION_STATE.ACTIVE), { refuse: true, backend: "active" });
  // Nothing held locally: the backend must be asked, and only an ACTIVE session blocks.
  assert.deepEqual(adoptGuard("fresh", null), { refuse: false, backend: "active" });
  // Cold stays strict: any held session refuses, an empty slot still asks the backend for any row.
  assert.equal(adoptGuard("cold", SESSION_STATE.NEEDS_OTP).refuse, true);
  assert.deepEqual(adoptGuard("cold", null), { refuse: false, backend: "any" });
  assert.deepEqual(adoptGuard(null, SESSION_STATE.ACTIVE), { refuse: false, backend: null });
});

test("adoptAndCapture replaces a dead (needs_otp) entry and closes its old browser", async () => {
  const closed = [];
  const m = new PersistentSessionManager({
    driver: { keepWarm: async () => ({ ok: true, orgVerified: true, cookies: [{ name: "sid", value: "fresh" }] }), close: async (e) => closed.push(e.handle) },
    post: async () => "posted",
  });
  const dead = { id: "dead" };
  await m.adopt("7", dead, { orgUuid: "o" });
  m.sessions.get("7").state = SESSION_STATE.NEEDS_OTP;
  const out = await m.adoptAndCapture("7", { id: "fresh" }, { orgUuid: "o", cookies: [{ name: "sid", value: "fresh" }] });
  assert.deepEqual(out, { captured: true });
  assert.equal(m.stateOf("7"), SESSION_STATE.ACTIVE);
  assert.deepEqual(closed, [dead]);
});

test("an email-less passkey relogin is admitted on a rideable state", () => {
  const r = admitStart({ email: "", passkey: true, company_key: "7" }, on("needs_otp"));
  assert.equal(r.ok, true);
});

test("an email-less start without the passkey flag still needs the email", () => {
  const r = admitStart({ email: "", company_key: "7" }, on("needs_otp"));
  assert.equal(r.ok, false);
  assert.equal(r.http, 422);
  assert.equal(r.body.error, "email required");
});
