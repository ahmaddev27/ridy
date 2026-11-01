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
