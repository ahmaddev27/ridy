// The session jar fingerprint — one definition, read from three places.
//
// The constructor stores it, liveJarFingerprint() recomputes it from the live Maps,
// and the supervisor's reconcile recomputes it from the backend row. persistJar()
// and reconcile then COMPARE those readings, so if any two of them disagree the
// daemon churns: it writes a jar nothing rotated, and reconcile reads the drift as
// "cookies changed" and restarts the stream. That is the cookie-churn pattern behind
// the offer-loss incident, so these tests pin all three together.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DISPATCH_INGEST_SECRET ??= "test-dispatch-secret";

const { RamenStream, sessionJarFingerprint, effectiveSupplierCookies } = await import("../src/stream.js");
const { api } = await import("../src/api.js");

const originalApi = { ...api };

beforeEach(() => {
  Object.assign(api, originalApi);
  for (const name of Object.keys(api)) api[name] = async () => ({ data: {} });
});

const ramen = [{ name: "sid", value: "v1" }];
const supplier = [{ name: "fleethub", value: "s1" }];

function streamFor(session) {
  const stream = new RamenStream(session, "/ramendca/events");
  stream.sleep = async () => {};

  return stream;
}

test("a legacy session with no supplier cookies still agrees with its own live jar", () => {
  // THE REGRESSION. supplierJar falls back to the RAMEN cookies for rows captured
  // before supplier cookies existed; the stored fingerprint used to hash the raw
  // (empty) column instead, so these two could never be equal and persistJar()'s
  // "nothing changed" guard never fired.
  const session = { id: 1, uber_org_uuid: "org", cookies: ramen, proxy_url: "" };
  const stream = streamFor(session);

  assert.equal(stream.cookieFp, stream.liveJarFingerprint().fp);
  assert.equal(stream.cookieFp, sessionJarFingerprint(session));
  stream.stop();
});

test("the same holds for an explicitly empty supplier jar", () => {
  for (const empty of [[], null, undefined, {}]) {
    const session = { id: 1, uber_org_uuid: "org", cookies: ramen, supplier_cookies: empty, proxy_url: "" };
    const stream = streamFor(session);

    assert.equal(stream.cookieFp, stream.liveJarFingerprint().fp, `supplier_cookies = ${JSON.stringify(empty)}`);
    stream.stop();
  }
});

test("a session WITH supplier cookies agrees too", () => {
  const session = { id: 1, uber_org_uuid: "org", cookies: ramen, supplier_cookies: supplier, proxy_url: "" };
  const stream = streamFor(session);

  assert.equal(stream.cookieFp, stream.liveJarFingerprint().fp);
  assert.equal(stream.cookieFp, sessionJarFingerprint(session));
  stream.stop();
});

test("the supervisor's reading of a row matches the stream built from it", () => {
  // reconcile() computes this straight off the backend row and compares it to the
  // running stream's cookieFp to decide whether to tear the stream down.
  for (const session of [
    { id: 1, uber_org_uuid: "org", cookies: ramen, proxy_url: "" },
    { id: 2, uber_org_uuid: "org", cookies: ramen, supplier_cookies: supplier, proxy_url: "" },
  ]) {
    const stream = streamFor(session);

    assert.equal(sessionJarFingerprint(session), stream.cookieFp);
    stream.stop();
  }
});

test("a session carrying only the RAMEN jar and one carrying it twice read the same", () => {
  // Because the fallback IS "use the RAMEN jar", a row with no supplier cookies and
  // a row that stores the RAMEN cookies as its supplier jar describe the same live
  // state — so they must fingerprint the same, or moving between the two forms
  // (which is exactly what the first persistJar write does) would look like a change.
  const implicit = { cookies: ramen };
  const explicit = { cookies: ramen, supplier_cookies: ramen };

  assert.equal(sessionJarFingerprint(implicit), sessionJarFingerprint(explicit));
});

test("a real rotation still changes the fingerprint", () => {
  // The whole point of hashing VALUES: a reconnect that returns the same cookie
  // NAMES with new values must still restart the stream.
  const before = { cookies: [{ name: "sid", value: "v1" }] };
  const after = { cookies: [{ name: "sid", value: "v2" }] };

  assert.notEqual(sessionJarFingerprint(before), sessionJarFingerprint(after));
});

test("a changed supplier jar alone changes the fingerprint", () => {
  const before = { cookies: ramen, supplier_cookies: [{ name: "fleethub", value: "s1" }] };
  const after = { cookies: ramen, supplier_cookies: [{ name: "fleethub", value: "s2" }] };

  assert.notEqual(sessionJarFingerprint(before), sessionJarFingerprint(after));
});

test("effectiveSupplierCookies is the one place the fallback is decided", () => {
  assert.deepEqual(effectiveSupplierCookies({ cookies: ramen, supplier_cookies: supplier }), supplier);
  assert.deepEqual(effectiveSupplierCookies({ cookies: ramen }), ramen);
  assert.deepEqual(effectiveSupplierCookies({ cookies: ramen, supplier_cookies: [] }), ramen);
  // A jar stored as an associative object reaches the daemon as a JSON object;
  // toCookieList normalizes it, so the fallback must not be fooled into firing.
  assert.deepEqual(effectiveSupplierCookies({ cookies: ramen, supplier_cookies: { a: supplier[0] } }), supplier);
  assert.deepEqual(effectiveSupplierCookies({}), []);
  assert.deepEqual(effectiveSupplierCookies(undefined), []);
});
