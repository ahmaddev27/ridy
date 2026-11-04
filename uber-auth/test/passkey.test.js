import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { registerPasskey, pickCredential } from "../src/passkey.js";

const CRED = { credentialId: "id", privateKey: "SECRET", rpId: "uber.com", userHandle: "u", signCount: 0, isResidentCredential: true, extra: "x" };

function fakes({ url = "https://account.uber.com/passkeys", credentials = [CRED], fireAdded = true, clickFails = false } = {}) {
  const closed = [];
  const client = new EventEmitter();
  client.send = async (m) => (m === "WebAuthn.getCredentials" ? { credentials } : m === "WebAuthn.addVirtualAuthenticator" ? { authenticatorId: "a" } : {});
  const locator = {
    first: () => locator,
    last: () => locator,
    click: async () => {
      if (clickFails) throw new Error("nf");
      if (fireAdded) client.emit("WebAuthn.credentialAdded");
    },
  };
  const page = { goto: async () => {}, url: () => url, getByRole: () => locator, waitForTimeout: async () => {} };
  const context = { addCookies: async () => {}, newPage: async () => page, newCDPSession: async () => client, close: async () => closed.push("context") };
  const browser = { close: async () => closed.push("browser") };
  return { closed, deps: { launch: async () => browser, newContext: async () => context, credentialMs: 50, overallMs: 500 } };
}

const args = { cookies: [{ name: "a", value: "b" }], supplierCookies: [], proxyUrl: null };

test("success returns only the stored credential fields and closes everything", async () => {
  const f = fakes();
  const r = await registerPasskey("1", args, f.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.credential, pickCredential(CRED));
  assert.equal("extra" in r.credential, false);
  assert.deepEqual(f.closed, ["context", "browser"]);
});

test("redirect to login is logged_out", async () => {
  const f = fakes({ url: "https://auth.uber.com/v2/?x=1" });
  assert.deepEqual(await registerPasskey("2", args, f.deps), { ok: false, reason: "logged_out" });
  assert.deepEqual(f.closed, ["context", "browser"]);
});

test("missing button is button_not_found", async () => {
  assert.deepEqual(await registerPasskey("3", args, fakes({ clickFails: true }).deps), { ok: false, reason: "button_not_found" });
});

test("no credentialAdded and none stored is timeout; added but empty is no_credential", async () => {
  assert.equal((await registerPasskey("4", args, fakes({ credentials: [], fireAdded: false }).deps)).reason, "timeout");
  assert.equal((await registerPasskey("5", args, fakes({ credentials: [] }).deps)).reason, "no_credential");
});

test("a launch failure is error and never throws", async () => {
  const f = fakes();
  const r = await registerPasskey("6", args, {
    ...f.deps,
    launch: async () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(r, { ok: false, reason: "error" });
});

test("a second concurrent registration is refused as capacity", async () => {
  const f = fakes();
  const first = registerPasskey("7", args, f.deps);
  assert.equal((await registerPasskey("8", args, fakes().deps)).reason, "capacity");
  assert.equal((await first).ok, true);
});

test("the overall deadline yields timeout", async () => {
  const f = fakes();
  const r = await registerPasskey("9", args, { ...f.deps, overallMs: 20, newContext: () => new Promise(() => {}) });
  assert.equal(r.reason, "timeout");
});
