// Short step budget so "nothing recognised" scenarios finish fast; config reads this at import.
process.env.UBER_AUTH_STEP_TIMEOUT = "60";

import { test } from "node:test";
import assert from "node:assert/strict";

const { detectStep, closeSession, startLogin, accountMatches, STATUS } = await import("../src/browser.js");

// A page whose visible texts / locators are scripted.
function fakePage({ url = "https://auth.uber.com/login", texts = [], frame = null, otp = false, body = "", idField = true } = {}) {
  const calls = { advanced: 0, filled: [] };
  const loc = (visible, extra = {}) => ({
    first: () => loc(visible, extra),
    or: () => loc(visible, extra),
    isVisible: async () => visible,
    boundingBox: async () => extra.box ?? null,
    waitFor: async () => {
      if (!visible) throw new Error("timeout");
    },
    fill: async (v) => calls.filled.push(v),
    pressSequentially: async (v) => calls.filled.push(v),
    inputValue: async () => calls.filled.at(-1) ?? "",
    press: async () => calls.advanced++,
    innerText: async () => body,
    click: async () => calls.advanced++,
  });
  const page = {
    calls,
    url: () => url,
    goto: async () => {},
    setDefaultTimeout: () => {},
    waitForTimeout: async () => {},
    keyboard: { press: async () => calls.advanced++ },
    getByText: (re) => loc(texts.some((t) => re.test(t))),
    getByPlaceholder: () => loc(idField),
    getByRole: () => loc(false),
    locator: (sel) => {
      if (/arkose|funcaptcha/.test(sel)) return loc(frame?.visible ?? false, { box: frame?.box });
      if (sel === "body") return loc(true);
      if (/email|tel|identifier/.test(sel)) return loc(idField);
      return loc(otp);
    },
  };
  return page;
}

test("the Arkose puzzle is classified explicitly, not as unknown", async () => {
  assert.equal(await detectStep(fakePage({ texts: ["Protecting your account", "Start Puzzle"] })), "arkose");
});

test("a VISIBLE, real-sized Arkose frame is recognised", async () => {
  assert.equal(await detectStep(fakePage({ frame: { visible: true, box: { width: 400, height: 500 } } })), "arkose");
});

test("a hidden or tiny preloaded Arkose frame never blocks the login", async () => {
  assert.equal(await detectStep(fakePage({ otp: true, frame: { visible: false, box: null } })), "otp");
  assert.equal(await detectStep(fakePage({ otp: true, frame: { visible: true, box: { width: 1, height: 1 } } })), "otp");
});

test("a normal code step is still the otp step", async () => {
  assert.equal(await detectStep(fakePage({ otp: true })), "otp");
});

test("legacy password login with nothing recognised stays bad_credentials, not blocked", async () => {
  const out = await startLogin({ email: "a@b.de", password: "pw", reuse: { browser: {}, context: {}, page: fakePage() } });
  assert.equal(out.status, STATUS.BAD_CREDENTIALS);
});

test("welcome back: a remembered DIFFERENT account never gets Continue pressed", async () => {
  const page = fakePage({ idField: false, body: "Welcome back, j***@other.de. Continue" });
  const out = await startLogin({ email: "ops@fleet.de", reuse: { browser: {}, context: {}, page } });
  assert.equal(out.status, STATUS.CHANNEL_UNAVAILABLE);
  assert.equal(page.calls.advanced, 0, "no click / Enter, so no code is sent");
});

test("welcome back: the matching (masked) account may continue", async () => {
  const page = fakePage({ idField: false, otp: true, body: "Welcome back o***@fleet.de" });
  const out = await startLogin({ email: "ops@fleet.de", reuse: { browser: {}, context: {}, page } });
  assert.equal(out.status, STATUS.MFA_REQUIRED);
  assert.ok(page.calls.advanced > 0);
});

test("accountMatches: full email, masked email, and no false positive", () => {
  assert.equal(accountMatches("Hi ops@fleet.de", "ops@fleet.de"), true);
  assert.equal(accountMatches("o***@fleet.de", "ops@fleet.de"), true);
  assert.equal(accountMatches("o•••@fleet.de", "ops@fleet.de"), true);
  assert.equal(accountMatches("j***@fleet.de", "ops@fleet.de"), false);
  assert.equal(accountMatches("o***@other.de", "ops@fleet.de"), false);
  assert.equal(accountMatches("", "ops@fleet.de"), false);
  assert.equal(accountMatches("anything", "no-at-sign"), false);
});

const { navigatePastPasskey, NAV_MAX_HOPS, ANOTHER_WAY_RE, EMAIL_OPTION_RE } = await import("../src/browser.js");

test("passkey nav: another-way then email option reaches otp", async () => {
  const clicked = [];
  const click = async (_p, re) => {
    const label = re === EMAIL_OPTION_RE ? (clicked.length ? "Email" : null) : "Try another way";
    if (label) clicked.push(label);
    return label;
  };
  let settles = 0;
  const settle = async () => (++settles === 2 ? "otp" : null);
  assert.equal(await navigatePastPasskey({}, { click, settle }), "otp");
  assert.deepEqual(clicked, ["Try another way", "Email"]);
});

test("passkey nav: no control found falls back to passkey", async () => {
  assert.equal(await navigatePastPasskey({}, { click: async () => null, settle: async () => null }), "passkey");
});

test("passkey nav: bounded hops, then falls back", async () => {
  let clicks = 0;
  const click = async () => (++clicks, "x");
  assert.equal(await navigatePastPasskey({}, { click, settle: async () => null }), "passkey");
  assert.equal(clicks, NAV_MAX_HOPS);
});

test("passkey nav: Arkose after navigating is surfaced", async () => {
  assert.equal(await navigatePastPasskey({}, { click: async () => "x", settle: async () => "arkose" }), "arkose");
});

test("selectors match EN/DE variants", () => {
  for (const t of ["Try another way", "More options", "Weitere Optionen", "Andere Option", "Anders anmelden"]) assert.ok(ANOTHER_WAY_RE.test(t), t);
  for (const t of ["Email", "E-Mail", "Per E-Mail"]) assert.ok(EMAIL_OPTION_RE.test(t), t);
  // The email option must NOT catch the SMS/WhatsApp ones (they also "send a code").
  for (const t of ["SMS mit Anmeldecode senden", "Code über WhatsApp senden"]) assert.ok(!EMAIL_OPTION_RE.test(t), t);
});

test("a reused (persistent) browser is never closed by closeSession", async () => {
  let closed = 0;
  const browser = { close: async () => closed++ };
  await closeSession({ browser, reused: true });
  assert.equal(closed, 0);
  await closeSession({ browser });
  assert.equal(closed, 1);
});
