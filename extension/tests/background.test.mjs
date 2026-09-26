// Regression tests for the background worker. background.js is a plain MV3
// script (no modules), so it is evaluated in a VM context with a fake `chrome`
// API; its top-level function declarations become context globals.
//
//   node --test extension/tests/*.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, "..", "background.js"), "utf8");
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) {
      Object.assign(data, obj);
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
  };
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** Load background.js with fake storage + a scripted fetch. */
function load({ storage = {}, fetchImpl, cookies = { ramen: [], supplier: [] }, tabUrls = {} } = {}) {
  const removedTabs = [];
  const local = makeArea(storage);
  const session = makeArea();
  const calls = [];
  const listeners = {};
  const alarms = new Map();
  const chrome = {
    runtime: {
      id: "ext-id",
      getURL: (p) => `chrome-extension://ext-id/${p}`,
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      onInstalled: { addListener: (fn) => (listeners.installed = fn) },
      onStartup: { addListener: (fn) => (listeners.startup = fn) },
    },
    storage: { local, session },
    alarms: {
      get: async (name) => alarms.get(name),
      create: (name, info) => alarms.set(name, info),
      onAlarm: { addListener: (fn) => (listeners.alarm = fn) },
    },
    cookies: {
      getAll: async ({ url }) => (url.includes("vsdispatch") ? cookies.ramen : cookies.supplier),
    },
    tabs: {
      create: async () => ({ id: 1 }),
      remove: async (id) => removedTabs.push(id),
      get: async (id) => {
        if (!(id in tabUrls)) throw new Error("No tab with id");
        return { url: tabUrls[id] };
      },
    },
  };
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return fetchImpl ? fetchImpl(url, init) : jsonResponse(200, { data: {} });
  };
  const context = vm.createContext({
    chrome,
    fetch,
    console: { log() {}, warn() {}, error() {} },
    URL,
    TextEncoder,
    crypto: globalThis.crypto,
    setTimeout: () => 0,
    Intl,
  });
  vm.runInContext(SOURCE, context);
  return { ctx: context, local, session, calls, listeners, alarms, removedTabs };
}

test("persisted tab closes survive a worker restart and never close a reused tab id", async () => {
  const past = Date.now() - 1000;
  const { ctx, local, removedTabs, alarms } = load({
    storage: {
      pendingTabCloses: [
        { tabId: 7, closeAt: past, host: "vsdispatch.uber.com" },
        { tabId: 8, closeAt: past, host: "account.uber.com" }, // id now belongs to another site
        { tabId: 9, closeAt: past, host: "account.uber.com" }, // already gone
        { tabId: 10, closeAt: Date.now() + 60000, host: "vsdispatch.uber.com" },
      ],
    },
    tabUrls: { 7: "https://vsdispatch.uber.com/", 8: "https://example.org/", 10: "https://vsdispatch.uber.com/" },
  });
  await ctx.sweepPendingTabCloses();
  assert.deepEqual(removedTabs, [7]);
  assert.deepEqual(local.data.pendingTabCloses.map((p) => p.tabId), [10]);
  assert.ok(alarms.has("ridy-tabclose"), "an alarm is armed for the remaining close");
});

const PAIRED = { apiUrl: "https://reidey.de", token: "1|secret" };

test("fingerprint changes when the session id value changes but lengths stay equal", async () => {
  const { ctx } = load();
  const a = await ctx.fingerprint(ORG_A, [{ name: "sid", value: "aaaa" }, { name: "jwt-session", value: "xxxx" }]);
  const b = await ctx.fingerprint(ORG_A, [{ name: "sid", value: "bbbb" }, { name: "jwt-session", value: "xxxx" }]);
  assert.notEqual(a, b);
  assert.match(a, /^v2:[0-9a-f]{64}$/);
  assert.ok(!a.includes("aaaa"), "no plaintext cookie in the fingerprint");
});

test("fingerprint ignores a same-length rotation of short-lived tokens (no daemon restart)", async () => {
  const { ctx } = load();
  const a = await ctx.fingerprint(ORG_A, [{ name: "sid", value: "s1" }, { name: "jwt-session", value: "abcd" }]);
  const b = await ctx.fingerprint(ORG_A, [{ name: "jwt-session", value: "wxyz" }, { name: "sid", value: "s1" }]);
  assert.equal(a, b);
});

test("fingerprint covers the supplier jar and the org", async () => {
  const { ctx } = load();
  const ramen = [{ name: "sid", value: "s1" }];
  const base = await ctx.fingerprint(ORG_A, ramen, [{ name: "sid", value: "s1" }]);
  assert.notEqual(base, await ctx.fingerprint(ORG_A, ramen, [{ name: "sid", value: "s2" }]));
  assert.notEqual(base, await ctx.fingerprint(ORG_B, ramen, [{ name: "sid", value: "s1" }]));
});

test("a 401 from the backend clears the token so the dashboard re-pairs", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A, lastSync: "v2:x" },
    fetchImpl: () => jsonResponse(401, { message: "Unauthenticated." }),
  });
  const res = await ctx.postRoster([{ id: 1 }]);
  assert.equal(res.reason, "unpaired");
  assert.equal(local.data.token, undefined);
  assert.equal(local.data.lastSync, undefined);
  assert.equal(local.data.apiUrl, PAIRED.apiUrl, "apiUrl kept for an instant re-pair");
});

test("a late 401 on the old token never deletes a token paired meanwhile", async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A },
    fetchImpl: () => held,
  });
  const pending = ctx.postRoster([{ id: 1 }]); // in flight on the OLD token
  await new Promise((r) => setImmediate(r));
  await local.set({ token: "2|fresh" }); // the dashboard re-paired meanwhile
  release(jsonResponse(401, { message: "Unauthenticated." }));
  const res = await pending;
  assert.equal(res.reason, "unpaired");
  assert.equal(local.data.token, "2|fresh", "the fresh token survives the stale 401");
});

test("a 403/409 pauses the poll; a 429 honours Retry-After", async () => {
  for (const [status, message] of [[403, "company_inactive"], [409, "not_connected"]]) {
    const { ctx, local } = load({
      storage: { ...PAIRED, orgUuid: ORG_A },
      fetchImpl: () => jsonResponse(status, { message }),
    });
    const res = await ctx.postRoster([]);
    assert.equal(res.reason, message);
    assert.equal(local.data.backendPause.reason, message);
    assert.ok(local.data.backendPause.until > Date.now() + 14 * 60 * 1000);
    assert.equal(await ctx.backendPaused(), true);
  }
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A },
    fetchImpl: () => jsonResponse(429, { message: "Too Many Attempts." }, { "retry-after": "120" }),
  });
  await ctx.postRoster([]);
  const wait = local.data.backendPause.until - Date.now();
  assert.ok(wait > 110 * 1000 && wait <= 120 * 1000);
});

test("409 org_mismatch drops the stored org and its replay templates", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A, "gqltpl:getSupplierBreakdownV2": { body: "{}" }, lastRosterAt: 1 },
    fetchImpl: () => jsonResponse(409, { message: "org_mismatch" }),
  });
  await ctx.postRoster([{ id: 1 }]);
  assert.equal(local.data.orgUuid, undefined);
  assert.equal(local.data["gqltpl:getSupplierBreakdownV2"], undefined);
  assert.equal(local.data.token, PAIRED.token);
});

test("the paused poll never touches Uber or the backend", async () => {
  const { ctx, calls } = load({
    storage: { ...PAIRED, orgUuid: ORG_A, backendPause: { until: Date.now() + 60000, reason: "not_connected" } },
  });
  await ctx.backgroundPoll();
  assert.equal(calls.length, 0);
});

test("two polls in one wake run once, and the roster is pulled at most every 30 minutes", async () => {
  const uberOk = (url) =>
    url.includes("GetDriverLiveLocation")
      ? jsonResponse(200, { status: "success", data: { driverLocations: [] } })
      : url.includes("getDrivers")
        ? jsonResponse(200, { status: "success", data: { driversData: [{ id: 1 }] } })
        : jsonResponse(200, { data: {} });
  const { ctx, calls, session, local } = load({ storage: { ...PAIRED, orgUuid: ORG_A }, fetchImpl: uberOk });

  await Promise.all([ctx.backgroundPoll(), ctx.backgroundPoll()]);
  assert.equal(calls.filter((c) => c.url.includes("GetDriverLiveLocation")).length, 1);
  assert.equal(calls.filter((c) => c.url.includes("getDrivers")).length, 1);
  assert.ok(typeof local.data.lastRosterAt === "number");

  // A cold-started worker a minute later: statuses again, roster NOT again.
  session.data.lastPollAt = Date.now() - 61000;
  await ctx.backgroundPoll();
  assert.equal(calls.filter((c) => c.url.includes("GetDriverLiveLocation")).length, 2);
  assert.equal(calls.filter((c) => c.url.includes("getDrivers")).length, 1);

  // Within the 50s gap (e.g. a second restart in the same minute): nothing.
  await ctx.backgroundPoll();
  assert.equal(calls.filter((c) => c.url.includes("GetDriverLiveLocation")).length, 2);
});

test("statuses carry the org they were pulled for", async () => {
  const { ctx, calls } = load({
    storage: { ...PAIRED, orgUuid: ORG_A },
    fetchImpl: (url) =>
      url.includes("GetDriverLiveLocation")
        ? jsonResponse(200, { status: "success", data: { driverLocations: [] } })
        : jsonResponse(200, { data: {} }),
  });
  await ctx.fetchDriverStatuses([]);
  const post = calls.find((c) => c.url.endsWith("/api/v1/drivers/statuses"));
  assert.equal(JSON.parse(post.init.body).uber_org_uuid, ORG_A);
});

test("capture treats 202 autolink_blocked as not connected and forgets the org", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A },
    cookies: { ramen: [{ name: "sid", value: "s" }], supplier: [] },
    fetchImpl: () => jsonResponse(202, { data: { status: "blocked", reason: "autolink_blocked" } }),
  });
  const res = await ctx.capture(ORG_A, null);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "autolink_blocked");
  assert.equal(local.data.orgUuid, undefined);
  assert.equal(local.data.lastSync, undefined);
});

test("a successful capture stores the hashed fingerprint and lifts a pause", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, backendPause: { until: Date.now() + 60000, reason: "not_connected" } },
    cookies: { ramen: [{ name: "sid", value: "s" }], supplier: [] },
    fetchImpl: () => jsonResponse(201, { data: { status: "active" } }),
  });
  const res = await ctx.capture(ORG_A, null, { manual: true });
  assert.equal(res.ok, true);
  assert.equal(local.data.orgUuid, ORG_A);
  assert.match(local.data.lastSync, /^v2:/);
  assert.equal(local.data.backendPause, undefined);
});

test("re-pairing to another company drops the previous org and templates", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A, "gqltpl:getEarnerBreakdownsV2": { body: "{}" } },
    fetchImpl: () => jsonResponse(200, { data: { uber_org_uuid: ORG_B } }),
  });
  const res = await ctx.applyPairing("https://reidey.de", "2|other");
  assert.equal(res.ok, true);
  assert.equal(local.data.token, "2|other");
  assert.equal(local.data.orgUuid, undefined);
  assert.equal(local.data["gqltpl:getEarnerBreakdownsV2"], undefined);
});

test("re-pairing the same company keeps its org", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A },
    fetchImpl: () => jsonResponse(200, { data: { uber_org_uuid: ORG_A } }),
  });
  await ctx.applyPairing("https://reidey.de", "3|fresh");
  assert.equal(local.data.orgUuid, ORG_A);
});

test("re-pairing drops the org when the backend cannot confirm it", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A },
    fetchImpl: () => jsonResponse(500, {}),
  });
  await ctx.applyPairing("https://reidey.de", "3|fresh");
  assert.equal(local.data.orgUuid, undefined);
});

test("pairing refuses a non-allowlisted backend", async () => {
  const { ctx, local } = load();
  const res = await ctx.applyPairing("https://evil.example", "1|x");
  assert.equal(res.ok, false);
  assert.equal(local.data.token, undefined);
});

test("unpair clears every pairing key", async () => {
  const { ctx, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_A, lastSync: "v2:x", connectPending: 1, "gqltpl:getSupplierBreakdownV2": { body: "{}" } },
  });
  await ctx.clearPairing();
  assert.deepEqual(Object.keys(local.data), []);
});

const query = (op) => JSON.stringify({ operationName: op, query: `query ${op}($orgUUID: String) { x }`, variables: { orgUUID: ORG_A } });

test("replay templates: only allowlisted read-only queries from the Fleet UI are stored", async () => {
  const { ctx, local } = load();
  const fleet = { id: "ext-id", url: "https://fleethub.uber.com/orgs/x" };
  assert.equal(await ctx.storeGraphqlTemplate({ operationName: "getSupplierBreakdownV2", body: query("getSupplierBreakdownV2") }, fleet), true);
  assert.equal(local.data["gqltpl:getSupplierBreakdownV2"].host, "fleethub.uber.com");
  assert.equal(local.data["gqltpl:getSupplierBreakdownV2"].url, undefined, "page-supplied URL is never stored");

  const mutation = JSON.stringify({ operationName: "getSupplierBreakdownV2", query: "mutation getSupplierBreakdownV2 { deleteAll }" });
  assert.equal(await ctx.storeGraphqlTemplate({ operationName: "getSupplierBreakdownV2", body: mutation }, fleet), false);
  assert.equal(await ctx.storeGraphqlTemplate({ operationName: "deleteBankAccount", body: query("deleteBankAccount") }, fleet), false);
  assert.equal(
    await ctx.storeGraphqlTemplate({ operationName: "getEarnerBreakdownsV2", body: query("getSupplierBreakdownV2") }, fleet),
    false,
    "operationName must match the body",
  );
  assert.equal(
    await ctx.storeGraphqlTemplate({ operationName: "getEarnerBreakdownsV2", body: query("getEarnerBreakdownsV2") }, { id: "ext-id", url: "https://account.uber.com/" }),
    false,
  );
  assert.equal(
    await ctx.storeGraphqlTemplate({ operationName: "getEarnerBreakdownsV2", body: "x".repeat(70 * 1024) }, fleet),
    false,
  );
});

test("replay always posts to a fixed Fleet Hub origin and moves the period to the current fleet week", async () => {
  const body = JSON.stringify({
    operationName: "getEarnerBreakdownsV2",
    query: "query getEarnerBreakdownsV2 { x }",
    variables: { orgUUID: ORG_A, timeRange: { startTimeUnixMillis: "1700000000000", endTimeUnixMillis: "1700604800000" } },
  });
  const { ctx, calls } = load({
    storage: { ...PAIRED, orgUuid: ORG_A, "gqltpl:getEarnerBreakdownsV2": { url: "https://evil.example/graphql", body, at: 1 } },
    fetchImpl: () => jsonResponse(200, { data: {} }),
  });
  const res = await ctx.replayGraphql("getEarnerBreakdownsV2");
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, "https://fleethub.uber.com/graphql");
  const week = ctx.currentFleetWeek();
  assert.equal(res.variables.timeRange.startTimeUnixMillis, String(week.start));
  assert.equal(res.variables.timeRange.endTimeUnixMillis, String(week.end));
});

test("a template from another company's Fleet Hub is never replayed", async () => {
  const { ctx, calls, local } = load({
    storage: { ...PAIRED, orgUuid: ORG_B, "gqltpl:getSupplierBreakdownV2": { body: query("getSupplierBreakdownV2"), host: "fleethub.uber.com" } },
  });
  const res = await ctx.replayGraphql("getSupplierBreakdownV2");
  assert.equal(res.reason, "template_org_mismatch");
  assert.equal(calls.length, 0);
  assert.equal(local.data["gqltpl:getSupplierBreakdownV2"], undefined);
});

test("current fleet week starts Monday 04:00 Europe/Berlin across DST", () => {
  const { ctx } = load();
  // Thu 2026-09-24 12:00 CEST → Mon 2026-09-21 04:00 CEST (02:00Z) … Mon 2026-09-28 02:00Z.
  let w = ctx.currentFleetWeek(Date.UTC(2026, 8, 24, 10));
  assert.equal(new Date(w.start).toISOString(), "2026-09-21T02:00:00.000Z");
  assert.equal(new Date(w.end).toISOString(), "2026-09-28T02:00:00.000Z");
  // Mon 03:30 Berlin still belongs to the previous fleet week.
  w = ctx.currentFleetWeek(Date.UTC(2026, 8, 28, 1, 30));
  assert.equal(new Date(w.start).toISOString(), "2026-09-21T02:00:00.000Z");
  // Week containing the Oct 25 DST switch: CEST start, CET end.
  w = ctx.currentFleetWeek(Date.UTC(2026, 9, 22, 12));
  assert.equal(new Date(w.start).toISOString(), "2026-10-19T02:00:00.000Z");
  assert.equal(new Date(w.end).toISOString(), "2026-10-26T03:00:00.000Z");
  // A winter week.
  w = ctx.currentFleetWeek(Date.UTC(2027, 0, 6, 12));
  assert.equal(new Date(w.start).toISOString(), "2027-01-04T03:00:00.000Z");
});

test("a shorter-than-week template runs from the week start up to now, keeping number types", () => {
  const { ctx } = load();
  const now = Date.UTC(2026, 8, 24, 10);
  const v = ctx.withCurrentPeriod({ timeRange: { startTimeUnixMillis: 1, endTimeUnixMillis: 86400001 } }, now);
  assert.equal(v.timeRange.startTimeUnixMillis, Date.UTC(2026, 8, 21, 2));
  assert.equal(v.timeRange.endTimeUnixMillis, now);
});

test("page-world captures are re-checked against the DSGVO allowlist", () => {
  const { ctx } = load();
  assert.equal(ctx.isAllowedCapture("https://fleethub.uber.com/api/getDrivers?x=1", {}), true);
  assert.equal(ctx.isAllowedCapture("https://fleethub.uber.com/graphql", { operationName: "getEarnerBreakdownsV2" }), true);
  assert.equal(ctx.isAllowedCapture("https://fleethub.uber.com/api/getBankAccounts", {}), false);
  assert.equal(ctx.isAllowedCapture("https://fleethub.uber.com/graphql", { operationName: "getInvoices" }), false);
  assert.equal(ctx.isAllowedCapture("https://fleethub.uber.com/graphql", {}), false);
});

test("message router: offers only from vsdispatch, captures only from the Fleet UI, and no foreign senders", async () => {
  const { listeners, calls } = load({ storage: { ...PAIRED, orgUuid: ORG_A } });
  const send = (msg, sender) =>
    new Promise((resolve) => {
      const async = listeners.message(msg, sender, resolve);
      if (!async) setImmediate(() => resolve("no-response"));
    });

  const offer = { type: "offers", offers: [{ uuid: "o1" }], seq: 1 };
  assert.equal((await send(offer, { id: "ext-id", url: "https://fleethub.uber.com/" })).reason, "not_allowed");
  assert.equal((await send({ ...offer, offers: new Array(51).fill({}) }, { id: "ext-id", url: "https://vsdispatch.uber.com/" })).reason, "not_allowed");
  assert.equal(await send(offer, { id: "other-extension", url: "https://vsdispatch.uber.com/" }), "no-response");
  assert.equal(calls.length, 0);

  await send(offer, { id: "ext-id", url: "https://vsdispatch.uber.com/" });
  assert.ok(calls.some((c) => c.url.endsWith("/api/v1/dispatch/offers/ingest")));

  const bank = { type: "supplier_capture", kind: "bank", url: "https://fleethub.uber.com/api/getBankAccounts", payload: {} };
  assert.equal((await send(bank, { id: "ext-id", url: "https://fleethub.uber.com/" })).reason, "not_allowed");

  const pair = { type: "pair", apiUrl: "https://reidey.de", token: "9|x" };
  assert.equal(await send(pair, { id: "ext-id", url: "https://fleethub.uber.com/" }), "no-response");
});
