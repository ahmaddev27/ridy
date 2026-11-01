import { test } from "node:test";
import assert from "node:assert/strict";

import { admitStart, createStartGate } from "../src/loginPolicy.js";
import { SESSION_STATE } from "../src/sessionManager.js";

const policy = (state = null, coldEnabled = true) => ({ passwordless: true, stateOf: () => state, coldEnabled });
const body = { email: "a@b.de", company_key: "7", cold: true, proxy_url: "http://u:p@proxy.test:8000" };

test("cold connect: flag on + backend says cold + nothing held -> admitted as cold", () => {
  const r = admitStart(body, policy());
  assert.deepEqual([r.ok, r.cold, r.password], [true, true, null]);
});

test("cold connect is refused while the cold flag is off, even if the backend asks", () => {
  const r = admitStart(body, policy(null, false));
  assert.equal(r.ok, false);
  assert.equal(r.body.status, "no_session");
});

test("cold connect needs the backend's explicit cold=true", () => {
  assert.equal(admitStart({ email: "a@b.de", company_key: "7" }, policy()).ok, false);
});

test("a cold start is unreachable for any HELD company (active, logging_in, down, not_set_up)", () => {
  for (const state of [SESSION_STATE.ACTIVE, SESSION_STATE.LOGGING_IN, SESSION_STATE.DOWN, SESSION_STATE.NOT_SET_UP]) {
    assert.notEqual(admitStart(body, policy(state)).cold, true, state);
  }
  assert.equal(admitStart(body, policy(SESSION_STATE.ACTIVE)).body.status, "session_active");
});

test("a warm admission is never cold", () => {
  assert.equal(admitStart(body, policy(SESSION_STATE.NEEDS_OTP)).cold, false);
});

test("the gate refuses a second concurrent cold start", () => {
  const gate = createStartGate({ markLoggingIn: () => true });
  assert.equal(gate.enter("7").ok, true);
  assert.equal(gate.enter("7").body.status, "start_in_flight");
  gate.leave("7");
  assert.equal(gate.enter("7").ok, true);
});

test("a cold start without a valid proxy is refused as no_proxy, never run from the datacenter IP", () => {
  for (const proxy_url of [undefined, null, "", "nonsense", "ftp://p.test:1"]) {
    const r = admitStart({ ...body, proxy_url }, policy());
    assert.equal(r.ok, false);
    assert.equal(r.body.status, "no_proxy");
  }
});

test("no_proxy only applies to a cold request: an ACTIVE company still reads session_active", () => {
  assert.equal(admitStart({ ...body, proxy_url: null }, policy(SESSION_STATE.ACTIVE)).body.status, "session_active");
});
