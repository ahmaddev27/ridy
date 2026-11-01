import { test } from "node:test";
import assert from "node:assert/strict";

import { parseProxyUrl } from "../src/proxy.js";
import { newStealthContext } from "../src/browser.js";
import { tenantScreen } from "../src/fingerprint.js";

test("per-tenant screen is deterministic and varies across tenants", () => {
  assert.deepEqual(tenantScreen("8"), tenantScreen("8"));
  const widths = new Set(Array.from({ length: 40 }, (_, i) => tenantScreen(String(i)).viewport.width));
  assert.ok(widths.size > 1);
});

test("bundled (non real-Chrome) browsers keep today's UA and viewport", async () => {
  const f = { seen: [] };
  const browser = { newContext: async (o) => (f.seen.push(o), { addInitScript: async () => {} }) };
  await newStealthContext(browser, {}, null, "8");
  assert.match(f.seen[0].userAgent, /Chrome\/131/);
  assert.equal(f.seen[0].viewport.width, 1280);
});

test("parses server and credentials from a proxy URL", () => {
  assert.deepEqual(parseProxyUrl("http://us%40er:p%3Aw@10.0.0.1:8000"), {
    server: "http://10.0.0.1:8000",
    username: "us@er",
    password: "p:w",
  });
});

test("credential-less proxy has only a server", () => {
  assert.deepEqual(parseProxyUrl("http://proxy.example:3128"), { server: "http://proxy.example:3128" });
});

test("empty or invalid values mean no proxy", () => {
  for (const v of [null, undefined, "", "not a url", "ftp://x:1"]) assert.equal(parseProxyUrl(v), null);
});

function fakeBrowser() {
  const seen = [];
  const context = { addInitScript: async () => {} };
  return { seen, browser: { newContext: async (opts) => (seen.push(opts), context) } };
}

test("newStealthContext passes the proxy to the context, and omits it when none", async () => {
  const a = fakeBrowser();
  await newStealthContext(a.browser, {}, "http://u:p@10.0.0.1:8000");
  assert.deepEqual(a.seen[0].proxy, { server: "http://10.0.0.1:8000", username: "u", password: "p" });

  const b = fakeBrowser();
  await newStealthContext(b.browser, {}, null);
  assert.equal("proxy" in b.seen[0], false);
});
