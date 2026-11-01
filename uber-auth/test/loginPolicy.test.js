import { test } from "node:test";
import assert from "node:assert/strict";

import { admitStart, companyMatches } from "../src/loginPolicy.js";
import { PersistentSessionManager, SESSION_STATE } from "../src/sessionManager.js";

const on = (state = null) => ({ passwordless: true, stateOf: () => state });
const off = { passwordless: false, stateOf: () => null };

test("passwordless start needs only email + company_key", () => {
  const r = admitStart({ email: "a@b.de", company_key: 7 }, on());
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

test("needs_otp and unknown companies may start", () => {
  assert.equal(admitStart({ email: "a@b.de", company_key: "7" }, on(SESSION_STATE.NEEDS_OTP)).ok, true);
  assert.equal(admitStart({ email: "a@b.de", company_key: "7" }, on(null)).ok, true);
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
