import { test } from "node:test";
import assert from "node:assert/strict";
import { attachCobrowseAuthenticator, ATTACH } from "../src/cobrowsePasskey.js";
import { registerPasskeyInSession, STATUS, probeInPage, registerInPage } from "../src/passkey.js";
import { PersistentSessionManager } from "../src/sessionManager.js";

const CRED = { credentialId: "cid", privateKey: "PRIVATE-KEY", rpId: "uber.com", userHandle: "uh", signCount: 0, isResidentCredential: true };

function fakeSession() {
  const sent = [];
  const client = {
    send: async (m, p) => {
      sent.push([m, p]);
      return m === "WebAuthn.addVirtualAuthenticator" ? { authenticatorId: "auth1" } : {};
    },
  };
  const page = { context: () => ({ newCDPSession: async () => client }) };
  return { session: { page }, sent };
}

const deps = (over = {}) => ({
  enabled: () => true,
  flags: async () => ({ enabled: true }),
  fetchCredential: async () => CRED,
  ...over,
});

test("attach: authenticator + stored passkey injected into THIS page's context", async () => {
  const { session, sent } = fakeSession();
  assert.equal(await attachCobrowseAuthenticator(session, "7", deps()), ATTACH.INJECTED);
  assert.deepEqual(sent.map((s) => s[0]), ["WebAuthn.enable", "WebAuthn.addVirtualAuthenticator", "WebAuthn.addCredential"]);
  assert.deepEqual(sent[2][1], { authenticatorId: "auth1", credential: CRED });
  assert.equal(session.passkeyAuth.authenticatorId, "auth1");
});

test("attach: no stored passkey -> authenticator only, normal OTP path remains", async () => {
  const { session, sent } = fakeSession();
  assert.equal(await attachCobrowseAuthenticator(session, "7", deps({ fetchCredential: async () => null })), ATTACH.ATTACHED);
  assert.equal(sent.some((s) => s[0] === "WebAuthn.addCredential"), false);
});

test("attach: flag off or company disabled -> nothing touched", async () => {
  const a = fakeSession();
  assert.equal(await attachCobrowseAuthenticator(a.session, "7", deps({ enabled: () => false })), ATTACH.DISABLED);
  const b = fakeSession();
  assert.equal(await attachCobrowseAuthenticator(b.session, "7", deps({ flags: async () => ({ enabled: false }) })), ATTACH.COMPANY_DISABLED);
  assert.equal(a.sent.length + b.sent.length, 0);
});

test("attach: any CDP error is swallowed (never breaks the human's login)", async () => {
  const session = { page: { context: () => ({ newCDPSession: async () => { throw new Error("boom"); } }) } };
  assert.equal(await attachCobrowseAuthenticator(session, "7", deps()), ATTACH.FAILED);
});

async function inSessionSetup({ probe, reg, flags = { enabled: true, registered: false } }) {
  const stored = [];
  const closed = { page: false };
  const manager = new PersistentSessionManager({ driver: { keepWarm: async () => ({ ok: true, cookies: [] }), close: async () => {} }, post: async () => "posted" });
  await manager.adopt("7", { context: {}, page: {}, browser: {} }, { orgUuid: "org" });
  const evals = [probe, reg];
  const page = {
    goto: async () => {},
    url: () => "https://account.uber.com/passkeys",
    waitForTimeout: async () => {},
    evaluate: async (fn) => (fn === probeInPage ? evals[0] : evals[1]),
    close: async () => void (closed.page = true),
  };
  const client = { send: async (m) => (m === "WebAuthn.addVirtualAuthenticator" ? { authenticatorId: "a" } : m === "WebAuthn.getCredentials" ? { credentials: [CRED] } : {}) };
  const context = { newPage: async () => page, newCDPSession: async () => client };
  const d = {
    enabled: () => true,
    manager,
    backend: { status: async () => flags, store: async (_k, b) => void stored.push(b), fail: async () => {} },
    storeBackoffMs: 0,
  };
  return { d, context, stored, closed };
}

test("register in session: registers on the adopted context, stores it, closes only its own tab", async () => {
  const { d, context, stored, closed } = await inSessionSetup({ probe: { ok: true, count: 0 }, reg: { step: "done", account: "a@b.de", count: 1 } });
  assert.equal((await registerPasskeyInSession("7", context, d)).status, STATUS.REGISTERED);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].credential.privateKey, "PRIVATE-KEY");
  assert.equal(closed.page, true);
});

test("register in session: Uber has an orphaned passkey but we hold none -> still registers and stores", async () => {
  const { d, context, stored } = await inSessionSetup({ probe: { ok: true, count: 1 }, reg: { step: "done", account: "a@b.de", count: 2 } });
  assert.equal((await registerPasskeyInSession("7", context, d)).status, STATUS.REGISTERED);
  assert.equal(stored.length, 1);
});

test("register in session: backend already holds one / flag off / no active session", async () => {
  const a = await inSessionSetup({ probe: {}, reg: {}, flags: { enabled: true, registered: true } });
  assert.equal((await registerPasskeyInSession("7", a.context, a.d)).status, STATUS.ALREADY_REGISTERED);
  const b = await inSessionSetup({ probe: {}, reg: {} });
  b.d.enabled = () => false;
  assert.equal((await registerPasskeyInSession("7", b.context, b.d)).status, STATUS.DISABLED);
  const c = await inSessionSetup({ probe: {}, reg: {} });
  assert.equal((await registerPasskeyInSession("99", c.context, c.d)).status, STATUS.NO_SESSION);
});

test("register in session: exceptions never escape", async () => {
  const { d } = await inSessionSetup({ probe: {}, reg: {} });
  const ctx = { newPage: async () => { throw new Error("x"); } };
  d.alert = () => {};
  assert.equal((await registerPasskeyInSession("7", ctx, d)).status, STATUS.FAILED);
});

test("attach: refuses a non-proxied handle (relogin dep) and keeps userHandle + resident flag, dropping nulls", async () => {
  const a = fakeSession();
  assert.equal(await attachCobrowseAuthenticator(a.session, "7", deps({ proxied: () => false })), ATTACH.NO_PROXY);
  assert.equal(a.sent.length, 0);
  const b = fakeSession();
  await attachCobrowseAuthenticator(b.session, "7", deps({ proxied: () => true, fetchCredential: async () => ({ ...CRED, userHandle: null }) }));
  const injected = b.sent.at(-1)[1].credential;
  assert.equal(injected.isResidentCredential, true);
  assert.equal("userHandle" in injected, false);
  const c = fakeSession();
  await attachCobrowseAuthenticator(c.session, "7", deps({ proxied: () => true }));
  assert.equal(c.sent.at(-1)[1].credential.userHandle, "uh");
});
