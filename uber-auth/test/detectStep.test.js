import { test } from "node:test";
import assert from "node:assert/strict";

import { detectStep, closeSession } from "../src/browser.js";

// A page whose visible texts / locators are scripted.
function fakePage({ url = "https://auth.uber.com/login", texts = [], iframes = 0, otp = false } = {}) {
  const loc = (visible, count = 0) => ({
    first: () => loc(visible, count),
    or: () => loc(visible, count),
    isVisible: async () => visible,
    count: async () => count,
  });
  return {
    url: () => url,
    waitForTimeout: async () => {},
    getByText: (re) => loc(texts.some((t) => re.test(t))),
    locator: (sel) => (/arkose|funcaptcha/.test(sel) ? loc(false, iframes) : loc(otp)),
  };
}

test("the Arkose puzzle is classified explicitly, not as unknown", async () => {
  assert.equal(await detectStep(fakePage({ texts: ["Protecting your account", "Start Puzzle"] })), "arkose");
});

test("an Arkose iframe alone is also recognised", async () => {
  assert.equal(await detectStep(fakePage({ iframes: 1 })), "arkose");
});

test("a normal code step is still the otp step", async () => {
  assert.equal(await detectStep(fakePage({ otp: true })), "otp");
});

test("a reused (persistent) browser is never closed by closeSession", async () => {
  let closed = 0;
  const browser = { close: async () => closed++ };
  await closeSession({ browser, reused: true });
  assert.equal(closed, 0);
  await closeSession({ browser });
  assert.equal(closed, 1);
});
