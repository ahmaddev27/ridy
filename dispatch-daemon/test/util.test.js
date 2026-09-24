import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeProxy,
  isSupportedProxyUrl,
  jitter,
  nextThrottleDelay,
  normalizeSession,
  parseRetryAfter,
  parseSetCookie,
  scrubSensitive,
  statusSignature,
  toCookieList,
} from "../src/util.js";

const base = { id: 7, uber_org_uuid: "org-uuid-1234", cookies: [{ name: "sid", value: "abc" }] };

test("cookies stored as an associative object are normalized to a list", () => {
  const result = normalizeSession({ ...base, cookies: { x: { name: "sid", value: "abc" } } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.session.cookies, [{ name: "sid", value: "abc" }]);
});

test("a session without usable cookies is rejected, not thrown", () => {
  assert.equal(normalizeSession({ ...base, cookies: "garbage" }).ok, false);
  assert.equal(normalizeSession({ ...base, cookies: [{ name: "sid" }] }).ok, false);
  assert.equal(normalizeSession(null).ok, false);
  assert.equal(normalizeSession({ ...base, uber_org_uuid: undefined }).ok, false);
});

test("socks5 and scheme-less proxy URLs are rejected; http(s) accepted", () => {
  assert.equal(normalizeSession({ ...base, proxy_url: "socks5://u:p@host:1080" }).ok, false);
  assert.equal(normalizeSession({ ...base, proxy_url: "host:8080" }).ok, false);
  assert.equal(normalizeSession({ ...base, proxy_url: "http://u:p@host:8080" }).ok, true);
  assert.equal(normalizeSession({ ...base, proxy_url: "" }).ok, true);
  assert.equal(isSupportedProxyUrl("https://host:443"), true);
});

test("empty supplier cookies normalize to null so the RAMEN jar is the fallback", () => {
  const result = normalizeSession({ ...base, supplier_cookies: [] });
  assert.equal(result.session.supplier_cookies, null);
});

test("toCookieList drops entries without string name/value", () => {
  assert.deepEqual(toCookieList([{ name: "a", value: "1" }, { name: "", value: "2" }, null, { name: "b", value: 3 }]), [
    { name: "a", value: "1" },
  ]);
  assert.deepEqual(toCookieList(undefined), []);
});

test("describeProxy never leaks credentials, even with '@' in the password", () => {
  const described = describeProxy("http://user:p@ss@proxy.example:8080");
  assert.equal(described, "http://proxy.example:8080 (auth)");
  assert.ok(!described.includes("ss@"));
  assert.equal(describeProxy(""), "direct (no proxy)");
  assert.equal(describeProxy("::::"), "invalid proxy url");
});

test("parseSetCookie detects deletions", () => {
  const now = Date.parse("2026-09-24T10:00:00Z");
  assert.deepEqual(parseSetCookie("sid=abc; Path=/; HttpOnly", now), { name: "sid", value: "abc", deleted: false });
  assert.equal(parseSetCookie("sid=; Path=/", now).deleted, true);
  assert.equal(parseSetCookie("sid=abc; Max-Age=0", now).deleted, true);
  assert.equal(parseSetCookie("sid=abc; Expires=Thu, 01 Jan 1970 00:00:00 GMT", now).deleted, true);
  assert.equal(parseSetCookie("sid=abc; Expires=Fri, 01 Jan 2100 00:00:00 GMT; Max-Age=3600", now).deleted, false);
  assert.equal(parseSetCookie("garbage", now), null);
});

test("parseRetryAfter handles seconds, dates and junk", () => {
  const now = Date.parse("2026-09-24T10:00:00Z");
  assert.equal(parseRetryAfter("30", now), 30000);
  assert.equal(parseRetryAfter("Thu, 24 Sep 2026 10:00:10 GMT", now), 10000);
  assert.equal(parseRetryAfter("soon", now), 0);
  assert.equal(parseRetryAfter(null, now), 0);
});

test("nextThrottleDelay doubles, honours Retry-After and clamps", () => {
  assert.equal(nextThrottleDelay(0, 0, 6000, 60000), 6000);
  assert.equal(nextThrottleDelay(6000, 0, 6000, 60000), 12000);
  assert.equal(nextThrottleDelay(6000, 45000, 6000, 60000), 45000);
  assert.equal(nextThrottleDelay(48000, 0, 6000, 60000), 60000);
});

test("jitter stays within [ms/2, ms]", () => {
  assert.equal(jitter(2000, () => 0), 1000);
  assert.equal(jitter(2000, () => 0.999999), 2000);
});

test("statusSignature ignores location_updated_at only", () => {
  const row = { driver_uuid: "d", status: "ONLINE", latitude: 0, longitude: 0, heading: null, waypoints: null };
  assert.equal(statusSignature(row), statusSignature({ ...row, location_updated_at: 123 }));
  assert.notEqual(statusSignature(row), statusSignature({ ...row, status: "ON_TRIP" }));
});

test("scrubSensitive removes cookies, secrets and proxy credentials", () => {
  const event = {
    message: "POST failed via http://user:pa@ss@proxy:8080 with secret s3cr3t-value",
    request: { headers: { Cookie: "sid=abc", "X-Dispatch-Secret": "s3cr3t-value", accept: "*/*" } },
    breadcrumbs: [{ message: "cookie: sid=abc; csid=def" }],
    extra: { cookies: [{ name: "sid", value: "abc" }] },
  };
  const scrubbed = JSON.stringify(scrubSensitive(event, ["s3cr3t-value"]));
  assert.ok(!scrubbed.includes("s3cr3t-value"));
  assert.ok(!scrubbed.includes("sid=abc"));
  assert.ok(!scrubbed.includes("pa@ss"));
  assert.ok(!scrubbed.includes('"abc"'));
  assert.ok(scrubbed.includes("*/*"));
});
