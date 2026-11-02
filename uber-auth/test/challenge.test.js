process.env.UBER_AUTH_STEP_TIMEOUT = "60";

import { test } from "node:test";
import assert from "node:assert/strict";
import { canCobrowse } from "../src/loginPolicy.js";

const { startLogin, challengeTick, finishChallenge, STATUS, CHALLENGE_MAX_RETRIES } = await import("../src/browser.js");

// Scripted page: `arkose` toggles the visible puzzle, `otp` the code field, `tryAgain` the retry text.
function fakePage(state = {}) {
  const loc = (visible) => ({
    first: () => loc(visible),
    or: () => loc(visible),
    isVisible: async () => visible,
    boundingBox: async () => null,
    waitFor: async () => {},
    fill: async () => {},
    pressSequentially: async () => {},
    press: async () => {},
    inputValue: async () => "x",
    innerText: async () => "",
    click: async () => {},
  });
  const page = {
    state,
    url: () => state.url ?? "https://auth.uber.com/login",
    goto: async () => {},
    setDefaultTimeout: () => {},
    waitForTimeout: async () => {},
    keyboard: { press: async () => {} },
    frames: () => [page],
    getByText: (re) => loc(re.source.includes("puzzle") ? !!state.arkose : re.test("try again") && !!state.tryAgain),
    getByPlaceholder: () => loc(true),
    getByRole: () => loc(false),
    locator: (sel) => (/arkose|funcaptcha/.test(sel) ? loc(false) : /email|tel|identifier/.test(sel) ? loc(true) : loc(!!state.otp)),
  };
  return page;
}

const handle = (page) => ({ browser: {}, context: {}, page });

test("Arkose + cobrowse flag -> challenge_required with the session kept open", async () => {
  const out = await startLogin({ email: "a@b.de", reuse: handle(fakePage({ arkose: true })), cobrowse: true });
  assert.equal(out.status, STATUS.CHALLENGE_REQUIRED);
  assert.ok(out.session, "browser/session must stay open for the stream");
});

test("full + cobrowse parks BEFORE the email step: challenge_required, session open, fullLogin marked", async () => {
  let typed = false;
  const page = fakePage({});
  const origLocator = page.locator;
  page.locator = (sel) => {
    const l = origLocator(sel);
    return { ...l, fill: async () => { typed = true; }, pressSequentially: async () => { typed = true; } };
  };
  const session = handle(page);
  const out = await startLogin({ email: "a@b.de", reuse: session, cobrowse: true, full: true });
  assert.equal(out.status, STATUS.CHALLENGE_REQUIRED);
  assert.ok(out.session && out.session.fullLogin === true);
  assert.equal(typed, false, "the identifier must not be typed automatically");
});

test("full WITHOUT cobrowse does not park (non-full flow unchanged)", async () => {
  const out = await startLogin({ email: "a@b.de", reuse: handle(fakePage({ otp: true })), cobrowse: false, full: true });
  assert.notEqual(out.session?.fullLogin, true);
});

test("full + cobrowse on an already-authenticated page is still SUCCESS", async () => {
  const page = fakePage({ url: "https://supplier.uber.com/orgs/x" });
  const out = await startLogin({ email: "a@b.de", reuse: { browser: {}, context: { cookies: async () => [] }, page: Object.assign(page, { evaluate: async () => null }) }, cobrowse: true, full: true });
  assert.equal(out.status, STATUS.SUCCESS);
});

test("Arkose WITHOUT the flag is still blocked(arkose), unchanged", async () => {
  for (const cobrowse of [false, undefined]) {
    const out = await startLogin({ email: "a@b.de", reuse: handle(fakePage({ arkose: true })), cobrowse });
    assert.deepEqual({ status: out.status, message: out.message }, { status: STATUS.BLOCKED, message: "arkose" });
  }
});

test("the flag does not change non-Arkose outcomes", async () => {
  const out = await startLogin({ email: "a@b.de", reuse: handle(fakePage({ otp: true })), cobrowse: true });
  assert.equal(out.status, STATUS.MFA_REQUIRED);
});

test("challengeTick fullLogin: a stray non-dashboard page is NOT a landing", async () => {
  const session = { page: fakePage({ url: "https://www.uber.com/de/help" }), fullLogin: true };
  assert.equal(await challengeTick(session), "challenge");
  assert.equal(await challengeTick(session), "challenge");
});

test("challengeTick fullLogin: otp/password steps keep streaming (the human types the code)", async () => {
  assert.equal(await challengeTick({ page: fakePage({ otp: true }), fullLogin: true }), "challenge");
});

test("challengeTick fullLogin: only a STABLE landing on a fleet dashboard ends it", async () => {
  const session = { page: fakePage({ url: "https://vsdispatch.uber.com/" }), fullLogin: true };
  assert.equal(await challengeTick(session), "challenge"); // 1st tick debounced
  assert.equal(await challengeTick(session), "landed"); // 2nd consecutive tick
});

test("canCobrowse needs every precondition", () => {
  const ok = { requested: true, listening: true, secret: "s", originsConfigured: true, proxyUrl: "http://u:p@h:8080", realChrome: true, display: ":99" };
  assert.equal(canCobrowse(ok), true);
  for (const k of Object.keys(ok)) assert.equal(canCobrowse({ ...ok, [k]: k === "proxyUrl" ? null : false }), false, k);
  assert.equal(canCobrowse({ ...ok, requested: undefined }), false);
});

test("challengeTick: still on the puzzle, then left for the code step", async () => {
  const page = fakePage({ arkose: true });
  const session = { page };
  assert.equal(await challengeTick(session), "challenge");
  page.state.arkose = false;
  page.state.otp = true;
  assert.equal(await challengeTick(session), "otp");
});

test("challengeTick: N re-rendered 'try again' screens -> failed", async () => {
  const page = fakePage({ arkose: true });
  const session = { page };
  for (let i = 0; i < CHALLENGE_MAX_RETRIES; i++) {
    page.state.tryAgain = true;
    const r = await challengeTick(session);
    page.state.tryAgain = false;
    await challengeTick(session);
    if (i < CHALLENGE_MAX_RETRIES - 1) assert.equal(r, "challenge");
    else assert.equal(r, "failed");
  }
});

test("finishChallenge: otp keeps the session; password closes it", async () => {
  const s = { page: fakePage(), context: {}, browser: { close: async () => {} } };
  assert.equal((await finishChallenge(s, "otp")).status, STATUS.MFA_REQUIRED);
  assert.equal((await finishChallenge(s, "password")).status, STATUS.PASSWORD_REQUIRED);
});
