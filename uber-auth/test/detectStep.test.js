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
    innerText: async () => body,
    inputValue: async () => "x",
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

const { navigatePastPasskey, reachCodeStep, selectChannel, CHANNELS, NEVER_CLICK_RE, NAV_MAX_HOPS, ANOTHER_WAY_RE, EMAIL_OPTION_RE } =
  await import("../src/browser.js");

// A chooser: `labels` are always visible; `menu` labels appear after "Weitere Optionen" is clicked.
function chooser({ labels = [], menu = [] } = {}) {
  const clicked = [];
  let open = false;
  const click = async (_p, re) => {
    const visible = open ? [...labels, ...menu] : labels;
    const hit = visible.find((l) => re.test(l) && !NEVER_CLICK_RE.test(l));
    if (!hit && re === ANOTHER_WAY_RE && !open && menu.length) {
      open = true;
      clicked.push("MENU");
      return "Weitere Optionen";
    }
    if (hit) clicked.push(hit);
    return hit ?? null;
  };
  return { click, clicked };
}

test("channels: SMS is tried first, then WhatsApp, then e-mail", async () => {
  const c = chooser({ labels: ["Weiter mit Google", "E-Mail", "WhatsApp", "SMS mit Anmeldecode senden"] });
  const tried = new Set();
  assert.equal(await selectChannel({}, tried, { click: c.click }), "sms");
  tried.add("sms");
  assert.equal(await selectChannel({}, tried, { click: c.click }), "whatsapp");
  tried.add("whatsapp");
  assert.equal(await selectChannel({}, tried, { click: c.click }), "email");
});

test("channels: Google and passkey are never clicked", async () => {
  const c = chooser({ labels: ["Weiter mit Google", "Passkey verwenden"] });
  assert.equal(await selectChannel({}, new Set(), { click: c.click }), null);
  assert.deepEqual(c.clicked, []);
  assert.equal(CHANNELS.some((ch) => ch.re.test("Weiter mit Google")), false);
});

test("channels: options hidden behind 'Weitere Optionen' are revealed lazily", async () => {
  const c = chooser({ labels: [], menu: ["SMS mit Anmeldecode senden"] });
  assert.equal(await selectChannel({}, new Set(), { click: c.click }), "sms");
  assert.deepEqual(c.clicked, ["MENU", "SMS mit Anmeldecode senden"]);
});

test("passkey nav: first channel reaches otp with its name, no extra probing", async () => {
  const c = chooser({ labels: ["SMS mit Anmeldecode senden", "E-Mail"] });
  const tried = new Set();
  const out = await navigatePastPasskey({}, { click: c.click, settle: async () => "otp", tried });
  assert.deepEqual(out, { step: "otp", channel: "sms" });
  assert.deepEqual(c.clicked, ["SMS mit Anmeldecode senden"]);
});

test("channel switch on reject: next untried channel, SMS not repeated", async () => {
  const c = chooser({ labels: ["SMS mit Anmeldecode senden", "WhatsApp", "E-Mail"] });
  const out = await reachCodeStep({}, new Set(["sms"]), { click: c.click, settle: async () => "otp" });
  assert.deepEqual(out, { step: "otp", channel: "whatsapp" });
});

test("exhaustion: every channel tried -> passkey (terminal), nothing clicked", async () => {
  const c = chooser({ labels: ["SMS", "WhatsApp", "E-Mail", "Weiter mit Google"] });
  const out = await reachCodeStep({}, new Set(["sms", "whatsapp", "email", "call"]), { click: c.click, settle: async () => "otp" });
  assert.equal(out.step, "passkey");
  assert.deepEqual(c.clicked, []);
});

test("passkey nav: no control found falls back to passkey", async () => {
  assert.equal((await navigatePastPasskey({}, { click: async () => null, settle: async () => null })).step, "passkey");
});

test("passkey nav: bounded hops, then falls back", async () => {
  let n = 0;
  const names = ["SMS", "WhatsApp", "E-Mail", "Anruf"];
  const click = async (_p, re) => {
    const hit = names.find((l) => re.test(l));
    return hit && ++n ? hit : null;
  };
  const out = await navigatePastPasskey({}, { click, settle: async () => null });
  assert.equal(out.step, "passkey");
  assert.ok(n <= NAV_MAX_HOPS);
});

test("passkey nav: Arkose after navigating is surfaced", async () => {
  const c = chooser({ labels: ["SMS"] });
  assert.equal((await navigatePastPasskey({}, { click: c.click, settle: async () => "arkose" })).step, "arkose");
});

test("selectors match EN/DE variants", () => {
  for (const t of ["Try another way", "More options", "Andere Option", "Anders anmelden"]) assert.ok(ANOTHER_WAY_RE.test(t), t);
  for (const t of ["Email", "Per E-Mail", "Code senden", "Send code"]) assert.ok(EMAIL_OPTION_RE.test(t), t);
});

test("a reused (persistent) browser is never closed by closeSession", async () => {
  let closed = 0;
  const browser = { close: async () => closed++ };
  await closeSession({ browser, reused: true });
  assert.equal(closed, 0);
  await closeSession({ browser });
  assert.equal(closed, 1);
});
