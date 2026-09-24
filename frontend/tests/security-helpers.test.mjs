// Run with `npm test` (node --test; Node >= 23.6 strips the TypeScript types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeHref } from "../src/lib/safe-href.ts";
import { scrubUrl } from "../src/lib/sentry-scrub.ts";

const ORIGIN = "https://reidey.de";

test("safeHref keeps app-relative paths", () => {
  assert.equal(safeHref("/offers?offer=5", ORIGIN), "/offers?offer=5");
  assert.equal(safeHref("https://reidey.de/billing#x", ORIGIN), "/billing#x");
});

test("safeHref rejects script, data, other origins and protocol-relative links", () => {
  assert.equal(safeHref("javascript:alert(1)", ORIGIN), null);
  assert.equal(safeHref("JaVaScRiPt:alert(1)", ORIGIN), null);
  assert.equal(safeHref("data:text/html,<script>1</script>", ORIGIN), null);
  assert.equal(safeHref("//evil.example/x", ORIGIN), null);
  assert.equal(safeHref("https://evil.example/", ORIGIN), null);
  assert.equal(safeHref("", ORIGIN), null);
  assert.equal(safeHref(null, ORIGIN), null);
});

test("scrubUrl redacts the driver invite token and one-time codes", () => {
  assert.equal(
    scrubUrl("https://reidey.de/driver/activate?token=abc123&lang=de"),
    "https://reidey.de/driver/activate?token=[redacted]&lang=de",
  );
  assert.equal(scrubUrl("/reset?email=a%40b.de&code=123456#top"), "/reset?email=a%40b.de&code=[redacted]#top");
  assert.equal(scrubUrl("token=abc&x=1"), "token=[redacted]&x=1");
  assert.equal(scrubUrl("https://reidey.de/offers"), "https://reidey.de/offers");
});
