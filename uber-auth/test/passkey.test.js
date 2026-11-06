import { test } from "node:test";
import assert from "node:assert/strict";
import { registerPasskey, STATUS, pickCredential } from "../src/passkey.js";
import { PersistentSessionManager } from "../src/sessionManager.js";

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROXY = "http://user:pw@proxy.example:8080";
const STATE_FILE = join(tmpdir(), `passkey-test-state-${process.pid}.json`);
writeFileSync(STATE_FILE, JSON.stringify({ cookies: [] }));
const CRED ={ credentialId: "cid", privateKey: "PRIVATE-KEY", rpId: "uber.com", userHandle: "uh", signCount: 0, extra: "dropped" };

async function setup({ attemptResult, backend = {}, enabled = true, afterRenewState = null } = {}) {
  const calls = { stored: [], failed: [], alerts: [], attempts: 0 };
  const manager = new PersistentSessionManager({
    driver: {
      keepWarm: async () => (afterRenewState === "needs_otp" ? { ok: true, loggedOut: true } : { ok: true, cookies: [{ name: "a", value: "1" }] }),
      close: async () => {},
    },
    post: async () => "posted",
  });
  await manager.adopt("7", { context: { ctx: true }, page: {}, browser: {} }, { orgUuid: "org" });
  const deps = {
    enabled: () => enabled,
    manager,
    backend: {
      status: async () => ({ enabled: true, registered: false }),
      proxyUrl: async () => PROXY,
      store: async (_k, body) => void calls.stored.push(body),
      fail: async (_k, reason) => void calls.failed.push(reason),
      ...backend,
    },
    alert: (m) => calls.alerts.push(m),
    statePath: () => STATE_FILE,
    storeBackoffMs: 0,
    attemptFn: async () => {
      calls.attempts++;
      return attemptResult ?? { status: STATUS.REGISTERED, credential: pickCredential(CRED, "a@b.de") };
    },
  };
  return { calls, deps, manager };
}

test("env flag off: does nothing at all", async () => {
  const { calls, deps } = await setup({ enabled: false });
  assert.equal((await registerPasskey("7", deps)).status, STATUS.DISABLED);
  assert.equal(calls.attempts, 0);
});

test("backend company flag off: never touches Uber", async () => {
  const { calls, deps } = await setup({ backend: { status: async () => ({ enabled: false, registered: false }) } });
  assert.equal((await registerPasskey("7", deps)).status, STATUS.COMPANY_DISABLED);
  assert.equal(calls.attempts, 0);
});

test("backend unreachable: fails closed", async () => {
  const { calls, deps } = await setup({ backend: { status: async () => { throw new Error("down"); } } });
  assert.equal((await registerPasskey("7", deps)).status, STATUS.COMPANY_DISABLED);
  assert.equal(calls.attempts, 0);
});

test("already ours in the backend: skipped", async () => {
  const { calls, deps } = await setup({ backend: { status: async () => ({ enabled: true, registered: true }) } });
  assert.equal((await registerPasskey("7", deps)).status, STATUS.ALREADY_REGISTERED);
  assert.equal(calls.attempts, 0);
});

test("no held session / not active: refused without any attempt", async () => {
  const { calls, deps } = await setup();
  assert.equal((await registerPasskey("999", deps)).status, STATUS.NO_SESSION);
  assert.equal(calls.attempts, 0);
});

test("attempt reports already registered: skipped, nothing stored", async () => {
  const { calls, deps } = await setup({ attemptResult: { status: STATUS.ALREADY_REGISTERED } });
  assert.equal((await registerPasskey("7", deps)).status, STATUS.ALREADY_REGISTERED);
  assert.equal(calls.stored.length, 0);
});

test("success: stores only the picked fields, result carries no credential", async () => {
  const { calls, deps } = await setup();
  const r = await registerPasskey("7", deps);
  assert.equal(r.status, STATUS.REGISTERED);
  assert.equal(JSON.stringify(r).includes("PRIVATE-KEY"), false);
  assert.equal(calls.stored.length, 1);
  assert.equal(calls.stored[0].credential.privateKey, "PRIVATE-KEY");
  assert.equal(calls.stored[0].credential.account, "a@b.de");
  assert.equal("extra" in calls.stored[0].credential, false);
  assert.equal(calls.stored[0].uber_org_uuid, "org");
});

test("store failure: loud alert, failure reported, key not leaked", async () => {
  const { calls, deps } = await setup({ backend: { store: async () => { throw new Error("500"); } } });
  const r = await registerPasskey("7", deps);
  assert.equal(r.status, STATUS.STORE_FAILED);
  assert.deepEqual(calls.failed, ["store_failed"]);
  assert.ok(calls.alerts.length >= 1);
  assert.equal(calls.alerts.join().includes("PRIVATE-KEY"), false);
});

test("session died after the attempt: session_lost + loud alert + backend failure", async () => {
  const { calls, deps } = await setup({ afterRenewState: "needs_otp" });
  const r = await registerPasskey("7", deps);
  assert.equal(r.status, STATUS.SESSION_LOST);
  assert.ok(calls.failed.includes("session_lost"));
  assert.match(calls.alerts.join(), /needs a relink/);
});

test("a failed attempt is reported to the backend", async () => {
  const { calls, deps } = await setup({ attemptResult: { status: STATUS.FAILED, reason: "register_register_rejected" } });
  assert.equal((await registerPasskey("7", deps)).status, STATUS.FAILED);
  assert.deepEqual(calls.failed, ["register_register_rejected"]);
});

test("concurrent calls for one company: the second is busy", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { deps } = await setup();
  deps.attemptFn = async () => {
    await gate;
    return { status: STATUS.ALREADY_REGISTERED };
  };
  const first = registerPasskey("7", deps);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await registerPasskey("7", deps)).status, STATUS.BUSY);
  release();
  assert.equal((await first).status, STATUS.ALREADY_REGISTERED);
});

test("no company proxy: skipped as no_proxy, nothing read or launched", async () => {
  const { calls, deps } = await setup({ backend: { proxyUrl: async () => null } });
  assert.equal((await registerPasskey("7", deps)).status, STATUS.NO_PROXY);
  assert.equal(calls.attempts, 0);
});

test("missing state file: not_authenticated, nothing launched", async () => {
  const { calls, deps } = await setup();
  deps.statePath = () => join(tmpdir(), "does-not-exist-passkey.json");
  assert.equal((await registerPasskey("7", deps)).status, STATUS.NOT_AUTHENTICATED);
  assert.equal(calls.attempts, 0);
});

test("isolated browser: gets the state COPY + company proxy, never the held context, and is closed", async () => {
  const { deps, manager } = await setup();
  let seen = null;
  deps.attemptFn = undefined; // exercise the real attempt() with a fake launcher
  let closed = false;
  deps.launch = async (args) => {
    seen = args;
    return {
      browser: { close: async () => void (closed = true) },
      context: { newPage: async () => { throw new Error("stop"); } },
    };
  };
  const heldContext = manager.get("7").handle.context;
  await registerPasskey("7", deps);
  assert.equal(seen.proxyUrl, PROXY);
  assert.deepEqual(seen.state, { cookies: [] });
  assert.equal(closed, true);
  assert.equal(manager.get("7").handle.context, heldContext);
  assert.notEqual(manager.get("7").busy, true);
});
