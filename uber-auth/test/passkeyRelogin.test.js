import { test } from "node:test";
import assert from "node:assert/strict";
import { trySignInWithPasskey, PASSKEY_BUTTON_RE, NEVER_CLICK_RE } from "../src/browser.js";
import { removeAuthenticator, readSignCount } from "../src/cobrowsePasskey.js";
import { attachReloginPasskey, finishReloginPasskey } from "../src/persistent.js";

// Scripted login page: `buttons` are clickable controls; clicking the passkey one runs `onClick`.
function fakePage({ buttons = [], onClick = () => {}, arkose = false } = {}) {
  const state = { url: "https://auth.uber.com/login", clicked: [] };
  const el = (text) => ({
    isVisible: async () => true,
    isEnabled: async () => true,
    innerText: async () => text,
    click: async () => {
      state.clicked.push(text);
      onClick(state, text);
    },
  });
  const none = { first: () => none, isVisible: async () => false, boundingBox: async () => null };
  const page = {
    state,
    url: () => state.url,
    waitForTimeout: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    getByText: (re) => ({ first: () => ({ isVisible: async () => arkose && re.test("Protecting your account") }) }),
    locator: (sel) => {
      if (/button, a,/.test(sel)) {
        return { filter: ({ hasText }) => ({ all: async () => buttons.filter((b) => hasText.test(b)).map(el) }) };
      }
      return none;
    },
  };
  return page;
}
const quick = { clickWaitMs: 0, landWaitMs: 30 };
const land = (s) => (s.url = "https://drivers.uber.com/orgs/1");

test("clicks ONLY the passkey control (via PASSKEY_BUTTON_RE) and reports landed", async () => {
  const page = fakePage({ buttons: ["Mit Passkey anmelden", "Weiter", "Mit Google anmelden"], onClick: land });
  assert.equal(await trySignInWithPasskey(page, quick), "landed");
  assert.deepEqual(page.state.clicked, ["Mit Passkey anmelden"]);
});

test("no passkey control: nothing is clicked (Uber may auto-prompt) and a landing is still seen", async () => {
  const page = fakePage({ buttons: ["Weiter"] });
  setTimeout(() => land(page.state), 5);
  assert.equal(await trySignInWithPasskey(page, { clickWaitMs: 0, landWaitMs: 200 }), "landed");
  assert.deepEqual(page.state.clicked, []);
});

test("arkose and timeout fall through (never landed)", async () => {
  assert.equal(await trySignInWithPasskey(fakePage({ buttons: ["Passkey"], arkose: true }), quick), "arkose");
  assert.equal(await trySignInWithPasskey(fakePage({ buttons: ["Passkey"] }), quick), "timeout");
});

test("exceptions never escape", async () => {
  const page = fakePage();
  page.locator = () => { throw new Error("boom"); };
  assert.equal(await trySignInWithPasskey(page, quick), "timeout");
});

test("PASSKEY_BUTTON_RE is separate from NEVER_CLICK_RE, which still blocks passkeys in the code hunt", () => {
  assert.notEqual(PASSKEY_BUTTON_RE, NEVER_CLICK_RE);
  assert.ok(NEVER_CLICK_RE.test("Passkey") && NEVER_CLICK_RE.test("Google") && NEVER_CLICK_RE.test("Sicherheitsschlüssel"));
  assert.ok(PASSKEY_BUTTON_RE.test("Mit Passkey anmelden"));
  assert.ok(!PASSKEY_BUTTON_RE.test("Per E-Mail anmelden"));
});

function fakeAuth(signCount = 4) {
  const sent = [];
  const client = {
    send: async (m) => {
      sent.push(m);
      return m === "WebAuthn.getCredentials" ? { credentials: [{ signCount }] } : {};
    },
    detach: async () => sent.push("detach"),
  };
  return { handle: { passkeyAuth: { client, authenticatorId: "a1" }, passkeyInjected: true }, sent };
}

test("authenticator is removed (and cleared) in cleanup; signCount is readable first", async () => {
  const { handle, sent } = fakeAuth(7);
  assert.equal(await readSignCount(handle), 7);
  await removeAuthenticator(handle);
  assert.ok(sent.includes("WebAuthn.removeVirtualAuthenticator"));
  assert.equal(handle.passkeyAuth, null);
  assert.equal(handle.passkeyInjected, false);
  await removeAuthenticator(handle); // idempotent
});

test("injection refused when the relogin flag is off or the handle has no proxy", async () => {
  const handle = { page: { context: () => ({ newCDPSession: async () => { throw new Error("must not attach"); } }) } };
  // flags default OFF in the test env
  assert.equal(await attachReloginPasskey(handle, "7", "http://u:p@proxy.example:8000"), false);
  assert.equal(handle.passkeyInjected, false);
});

test("finish with nothing attached still never throws and clears flags", async () => {
  const handle = { passkeyTried: true, passkeyLanded: false, passkeyInjected: false };
  await finishReloginPasskey(handle, "7");
  assert.equal(handle.passkeyTried, false);
});
