// RamenStream.dispatchAction — the ONE call this product makes that WRITES to Uber.
//
// Driven through undici's MockAgent rather than a stubbed global fetch, because
// stream.js imports fetch from undici directly and passes an explicit dispatcher.
// Routing a MockAgent in as that dispatcher exercises the real request path, so
// these assertions cover the headers and body Uber would actually receive.
//
// Two behaviours matter more than any other and are asserted explicitly:
//   1. It must never THROW. The caller reports whatever comes back, so a throw
//      leaves the driver's command hanging until it expires.
//   2. It must separate "Uber REFUSED" (isSuccess false — a real verdict) from
//      "we never got a verdict" (isSuccess null — timeout, 5xx, unreadable body).
//      Only a real `true` may stamp a confirmed decline on the offer, and a call
//      Uber might actually have applied must not be recorded as a definite failure.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MockAgent } from "undici";

process.env.DISPATCH_INGEST_SECRET ??= "test-dispatch-secret";

const { RamenStream } = await import("../src/stream.js");
const { api } = await import("../src/api.js");
const { config } = await import("../src/config.js");

const originalApi = { ...api };

const session = () => ({
  id: 1,
  uber_org_uuid: "org-uuid-12345678",
  cookies: [{ name: "sid", value: "v1" }],
  supplier_cookies: [{ name: "fleethubonly", value: "nope" }],
  proxy_url: "",
});

const command = {
  action: "reject",
  offerUUID: "offer-uuid",
  realOfferUUID: "real-offer-uuid",
  offerType: "JOB",
  driverUUID: "driver-uuid",
};

const offerResponse = (fields) => ({ data: { rejectOffers: { offerResponse: [fields] } } });

let agent;

beforeEach(() => {
  Object.assign(api, originalApi);
  // No test may reach the real backend.
  for (const name of Object.keys(api)) api[name] = async () => ({ data: {} });

  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent?.close();
});

function newStream() {
  const stream = new RamenStream(session(), "/ramendca/events");
  stream.sleep = async () => {};
  // The seam: dispatchAction passes this straight to undici.
  stream.dispatcher = agent;

  return stream;
}

/**
 * Intercept the one POST dispatchAction makes and record what Uber would see.
 * `respond` receives the parsed request body and returns [status, payload, headers].
 */
function intercept(respond) {
  const seen = [];
  agent
    .get(config.uberDispatchBase)
    .intercept({ path: "/graphql", method: "POST" })
    .reply((opts) => {
      const body = JSON.parse(opts.body);
      seen.push({ headers: opts.headers, body });
      const [statusCode, data, headers = {}] = respond(body);

      return { statusCode, data, responseOptions: { headers } };
    })
    .persist();

  return seen;
}

test("builds the mutation exactly to Uber's contract", async () => {
  const stream = newStream();
  const seen = intercept(() => [200, offerResponse({ isSuccess: true, errorMsg: null })]);

  await stream.dispatchAction(command);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.operationName, "RejectOffers");
  assert.match(seen[0].body.query, /^mutation RejectOffers\(\$offers:\s*\[Offer__Input\]\)/);
  // driverUUID sits BESIDE params, not inside it — the captured browser call's shape.
  assert.deepEqual(seen[0].body.variables, {
    offers: [
      {
        params: { offerUUID: "offer-uuid", offerType: "JOB", realOfferUUID: "real-offer-uuid" },
        driverUUID: "driver-uuid",
      },
    ],
  });
  stream.stop();
});

test("sends the vsdispatch jar, not the fleethub one, plus the browser-only headers", async () => {
  const stream = newStream();
  const seen = intercept(() => [200, offerResponse({ isSuccess: true, errorMsg: null })]);

  await stream.dispatchAction(command);

  const headers = seen[0].headers;
  // The mutation must ride the session that is RECEIVING the offers.
  assert.match(headers.cookie, /sid=v1/);
  assert.doesNotMatch(headers.cookie, /fleethubonly/);
  assert.equal(headers["x-csrf-token"], "x");
  // undici never sends these on its own; a browser always does.
  assert.equal(headers.origin, config.uberDispatchBase);
  assert.equal(headers.referer, `${config.uberDispatchBase}/`);
  assert.equal(headers["sec-fetch-site"], "same-origin");
  assert.equal(headers["x-uber-client-name"], "vs_dispatch");
  stream.stop();
});

test("reports Uber's acceptance faithfully", async () => {
  const stream = newStream();
  intercept(() => [200, offerResponse({ isSuccess: true, errorMsg: null })]);

  const out = await stream.dispatchAction(command);

  assert.equal(out.isSuccess, true);
  assert.equal(out.errorMsg, null);
  assert.ok(Number.isFinite(out.latencyMs));
  stream.stop();
});

test("a refusal is isSuccess false and carries Uber's reason", async () => {
  const stream = newStream();
  intercept(() => [200, offerResponse({ isSuccess: false, errorMsg: "offer no longer available" })]);

  const out = await stream.dispatchAction(command);

  assert.equal(out.isSuccess, false);
  assert.equal(out.errorMsg, "offer no longer available");
  stream.stop();
});

test("a refusal with no reason still reads as refused", async () => {
  const stream = newStream();
  intercept(() => [200, offerResponse({ isSuccess: false, errorMsg: null })]);

  const out = await stream.dispatchAction(command);

  assert.equal(out.isSuccess, false);
  assert.ok(out.errorMsg && out.errorMsg.length > 0);
  stream.stop();
});

test("a graphql errors[] array is a refusal, not an exception", async () => {
  const stream = newStream();
  intercept(() => [200, { errors: [{ message: "bad input" }] }]);

  const out = await stream.dispatchAction(command);

  assert.equal(out.isSuccess, false);
  assert.match(out.errorMsg, /bad input/);
  stream.stop();
});

test("a non-2xx is UNKNOWN, never a confirmed refusal", async () => {
  const stream = newStream();
  intercept(() => [503, { error: "upstream" }]);

  const out = await stream.dispatchAction(command);

  // Uber may well have applied it; recording a definite failure would be a lie.
  assert.equal(out.isSuccess, null);
  assert.match(out.errorMsg, /503/);
  stream.stop();
});

test("a network failure resolves as unknown instead of throwing", async () => {
  const stream = newStream();
  agent
    .get(config.uberDispatchBase)
    .intercept({ path: "/graphql", method: "POST" })
    .replyWithError(new Error("socket hang up"));

  const out = await stream.dispatchAction(command);

  assert.equal(out.isSuccess, null);
  assert.match(out.errorMsg, /socket hang up/);
  stream.stop();
});

test("an unreadable body is unknown, not a crash", async () => {
  const stream = newStream();
  agent
    .get(config.uberDispatchBase)
    .intercept({ path: "/graphql", method: "POST" })
    .reply(200, "<html>not json</html>", { headers: { "content-type": "text/html" } });

  const out = await stream.dispatchAction(command);

  assert.equal(out.isSuccess, null);
  stream.stop();
});

test("a reply with no offerResponse is unknown", async () => {
  const stream = newStream();
  intercept(() => [200, { data: { rejectOffers: { offerResponse: [] } } }]);

  const out = await stream.dispatchAction(command);

  assert.equal(out.isSuccess, null);
  stream.stop();
});

test("an incomplete payload never reaches Uber", async () => {
  const stream = newStream();
  const seen = intercept(() => [200, offerResponse({ isSuccess: true })]);

  const out = await stream.dispatchAction({ ...command, realOfferUUID: null });

  assert.equal(seen.length, 0);
  assert.equal(out.isSuccess, null);
  stream.stop();
});

test("an unknown action never reaches Uber", async () => {
  const stream = newStream();
  const seen = intercept(() => [200, offerResponse({ isSuccess: true })]);

  const out = await stream.dispatchAction({ ...command, action: "cancel" });

  assert.equal(seen.length, 0);
  assert.equal(out.isSuccess, null);
  stream.stop();
});

test("a stopped stream never fires the mutation", async () => {
  const stream = newStream();
  const seen = intercept(() => [200, offerResponse({ isSuccess: true })]);
  stream.stop();

  const out = await stream.dispatchAction(command);

  assert.equal(seen.length, 0);
  assert.equal(out.isSuccess, null);
});

test("accept maps to Uber's AcceptOffers — present in the executor, created by nothing", async () => {
  const stream = newStream();
  const seen = intercept(() => [200, { data: { acceptOffers: { offerResponse: [{ isSuccess: true, errorMsg: null }] } } }]);

  const out = await stream.dispatchAction({ ...command, action: "accept" });

  assert.equal(seen[0].body.operationName, "AcceptOffers");
  assert.match(seen[0].body.query, /mutation AcceptOffers/);
  assert.equal(out.isSuccess, true);
  stream.stop();
});

test("the rotated session cookie is absorbed from the mutation's own response", async () => {
  const stream = newStream();
  intercept(() => [
    200,
    offerResponse({ isSuccess: true, errorMsg: null }),
    { "set-cookie": "sid=v2; Path=/" },
  ]);

  await stream.dispatchAction(command);

  // A credentialed vsdispatch call — a free jar refresh on the path that matters most.
  assert.equal(stream.jar.get("sid"), "v2");
  stream.stop();
});

test("a long Uber error is clipped before it reaches the backend", async () => {
  const stream = newStream();
  intercept(() => [200, offerResponse({ isSuccess: false, errorMsg: "x".repeat(5000) })]);

  const out = await stream.dispatchAction(command);

  assert.ok(out.errorMsg.length < 400, `errorMsg was ${out.errorMsg.length} chars`);
  stream.stop();
});
