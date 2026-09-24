// Run with `npm test` (node --test; Node >= 23.6 strips the TypeScript types).
// The DOM walk itself needs a browser DOMParser; these cover the URL/style gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeStyle, isSafeUrl } from "../src/lib/sanitize-html.ts";

test("template links allow http(s), mailto, relative paths and {{variables}}", () => {
  for (const ok of ["https://reidey.de/x", "http://a.b", "mailto:a@b.de", "/billing", "#top", "{{reset_url}}"]) {
    assert.equal(isSafeUrl(ok), true, ok);
  }
});

test("template links reject script and data URLs, even obfuscated", () => {
  for (const bad of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example"]) {
    assert.equal(isSafeUrl(bad), false, bad);
  }
});

test("inline styles cannot fetch or execute", () => {
  assert.equal(isSafeStyle("color:#333;max-width:100%;border-radius:8px"), true);
  assert.equal(isSafeStyle("background:url(https://x/y.png)"), false);
  assert.equal(isSafeStyle("width:expression(alert(1))"), false);
  assert.equal(isSafeStyle("background:javascript:alert(1)"), false);
});
