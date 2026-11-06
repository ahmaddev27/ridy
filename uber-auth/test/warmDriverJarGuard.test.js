import { test } from "node:test";
import assert from "node:assert/strict";
import { createWarmDriver, ramenJarProblem } from "../src/warmDriver.js";
import { PersistentSessionManager, SESSION_STATE } from "../src/sessionManager.js";

const jwt = (expSec) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none" })}.${b({ exp: expSec })}.sig`;
};
const loop = () => new Error("page.goto: net::ERR_TOO_MANY_REDIRECTS");

function rig({ gotos, url = "https://vsdispatch.uber.com/", cookies }) {
  let n = 0;
  const page = {
    goto: async () => {
      const r = gotos[Math.min(n++, gotos.length - 1)];
      if (r) throw r;
    },
    url: () => url,
    evaluate: async () => null,
    waitForTimeout: async () => {},
  };
  const context = { clearCookies: async () => {}, addCookies: async () => {}, cookies: async () => cookies };
  const driver = createWarmDriver();
  driver.save = async () => {};
  return { driver, entry: { companyKey: "c", handle: { context, page }, backendJar: { cookies: [{ name: "jwt-session", value: jwt(1000) }] } } };
}
const run = ({ driver, entry }) => driver.keepWarm(entry, { inject: false, rescue: true });

test("persistent redirect loop: refused, no cookies", async () => {
  const r = await run(rig({ gotos: [loop()], cookies: [{ name: "jwt-session", value: jwt(2000) }] }));
  assert.equal(r.ok, false);
  assert.equal(r.error, "dispatch_unreachable");
  assert.equal(r.cookies, undefined);
});

test("not on the dispatch host (error page): refused", async () => {
  const r = await run(rig({ gotos: [null], url: "chrome-error://chromewebdata/", cookies: [{ name: "jwt-session", value: jwt(2000) }] }));
  assert.equal(r.error, "dispatch_unreachable");
});

test("fresh jwt-session posts", async () => {
  const r = await run(rig({ gotos: [null], cookies: [{ name: "jwt-session", value: jwt(2000) }] }));
  assert.equal(r.ok, true);
  assert.equal(r.cookies.length, 1);
});

test("missing jwt-session refused", async () => {
  const r = await run(rig({ gotos: [null], cookies: [{ name: "other", value: "x" }] }));
  assert.equal(r.error, "missing_jwt");
  assert.equal(r.cookies, undefined);
});

test("older-exp jwt-session refused; equal accepted", async () => {
  const old = await run(rig({ gotos: [null], cookies: [{ name: "jwt-session", value: jwt(500) }] }));
  assert.equal(old.error, "stale_jar");
  const same = await run(rig({ gotos: [null], cookies: [{ name: "jwt-session", value: jwt(1000) }] }));
  assert.equal(same.ok, true);
});

test("ramenJarProblem: no backend jar means no downgrade check", () => {
  assert.equal(ramenJarProblem([{ name: "jwt-session", value: "opaque" }], null), null);
});

test("manager: a refused result is not an error and leaves state untouched", async () => {
  const driver = { keepWarm: async () => ({ ok: false, refused: true, error: "dispatch_unreachable" }), close: async () => assert.fail("closed") };
  const posted = [];
  const m = new PersistentSessionManager({ driver, post: async (k, c) => posted.push(c), notify: async () => assert.fail("notified"), now: () => 5, errorsBeforeDown: 1, renewIntervalMs: 1, log: () => {} });
  m.sessions.set("c", { companyKey: "c", state: SESSION_STATE.ACTIVE, consecutiveErrors: 0, lastRenewAt: 0, tokenExpiries: {}, cookies: [], supplierCookies: [], handle: {} });
  await m.renew("c");
  assert.equal(m.sessions.get("c").state, SESSION_STATE.ACTIVE);
  assert.equal(m.sessions.get("c").consecutiveErrors, 0);
  assert.equal(posted.length, 0);
});
