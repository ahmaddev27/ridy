import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DISPATCH_INGEST_SECRET ??= "test-dispatch-secret";

const { RamenStream, inflight, ingestExpiresAt } = await import("../src/stream.js");
const { api } = await import("../src/api.js");
const { config } = await import("../src/config.js");

const originalApi = { ...api };
const session = () => ({ id: 1, uber_org_uuid: "org-uuid-12345678", cookies: [{ name: "sid", value: "v1" }], proxy_url: "" });

beforeEach(() => {
  Object.assign(api, originalApi);
  // No test may reach the real backend.
  for (const name of Object.keys(api)) api[name] = async () => ({ data: {} });
});

function newStream(options) {
  const stream = new RamenStream(session(), "/ramendca/events", options);
  stream.sleep = async () => {}; // retries/backoff run instantly in tests
  return stream;
}

function response({ status = 200, setCookies = [], frames = null } = {}) {
  const body = frames
    ? new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      })
    : null;
  return { status, ok: status >= 200 && status < 300, headers: { getSetCookie: () => setCookies, get: () => null }, body };
}

async function settle() {
  await Promise.allSettled([...inflight]);
  await new Promise((r) => setImmediate(r));
}

const offerFrame = (seq, driver, uuid) =>
  `data: ${JSON.stringify({
    msg: [{ seq, type: "push_fleet_unified_offer", msg: JSON.stringify({ offers: [{ offerUUID: uuid, driverInfo: { driverUUID: driver } }] }) }],
  })}\n`;

test("constructor tolerates a cookie jar stored as an object", () => {
  const stream = new RamenStream({ ...session(), cookies: { a: { name: "sid", value: "v1" } } }, "/ramendca/events");
  assert.equal(stream.jar.get("sid"), "v1");
  stream.stop();
});

test("drop-storm backoff grows exponentially and resets only after a healthy stream", async () => {
  const stream = newStream();
  stream.streamOpened = true;
  const delays = [];
  for (let i = 0; i < 12; i++) {
    stream.openedAt = Date.now(); // opened then dropped instantly
    await stream.afterCycle();
    delays.push(stream.reconnectDelay);
  }
  // First 5 rapid drops still take the fast path (delay stays at min).
  assert.deepEqual(delays.slice(0, 5), Array(5).fill(config.reconnectMinDelay));
  // From the 6th on it's a storm: 2s, 4s, 8s ... never reset by the successful opens.
  assert.equal(delays[5], config.reconnectMinDelay * 2);
  assert.equal(delays[6], config.reconnectMinDelay * 4);
  assert.equal(delays[7], config.reconnectMinDelay * 8);
  assert.equal(delays[11], config.reconnectMaxDelay);

  stream.openedAt = Date.now() - 60_000; // a stream that lived long enough
  await stream.afterCycle();
  assert.equal(stream.reconnectDelay, config.reconnectMinDelay);
  stream.stop();
});

test("a failed ingest is retried until it lands (offer not dropped)", async () => {
  const stream = newStream();
  let calls = 0;
  api.ingest = async () => {
    calls++;
    if (calls < 3) throw new Error("POST /ingest -> 503");
    return { routed: 1 };
  };
  stream.handleData(offerFrame(5, "driver-a", "o1").slice(5).trim());
  await settle();
  assert.equal(calls, 3);
  assert.equal(stream.seq, 5);
  assert.equal(stream.ingestBacklog.length, 0);
  assert.equal(stream.ingestDropped, 0);
  stream.stop();
});

test("ingest keeps one driver ordered but does not block other drivers", async () => {
  const stream = newStream();
  const order = [];
  let releaseA;
  const aBlocked = new Promise((r) => (releaseA = r));
  api.ingest = async (offers) => {
    const id = offers[0].offerUUID;
    order.push(`start:${id}`);
    if (id === "a1") await aBlocked;
    order.push(`end:${id}`);
    return {};
  };
  stream.handleData(offerFrame(1, "A", "a1").slice(5).trim());
  stream.handleData(offerFrame(2, "A", "a2").slice(5).trim());
  stream.handleData(offerFrame(3, "B", "b1").slice(5).trim());
  await new Promise((r) => setImmediate(r));
  // B went through while A's first offer is still in flight; A's second waits.
  assert.ok(order.includes("end:b1"));
  assert.ok(!order.includes("start:a2"));
  releaseA();
  await settle();
  assert.ok(order.indexOf("end:a1") < order.indexOf("start:a2"));
  stream.stop();
});

test("malformed frames are skipped without throwing", () => {
  const stream = newStream();
  let ingests = 0;
  api.ingest = async () => {
    ingests++;
    return {};
  };
  stream.handleData("null");
  stream.handleData('{"msg":[null, {"seq":9}]}');
  stream.handleData('{"msg":"nope"}');
  stream.handleData("{truncated");
  assert.equal(stream.seq, 9);
  assert.equal(ingests, 0);
  stream.stop();
});

test("readSse ingests offers without waiting on a hung heartbeat", async () => {
  const stream = newStream();
  stream.controller = new AbortController();
  api.heartbeat = () => new Promise(() => {}); // never settles
  const ingested = [];
  api.ingest = async (offers) => {
    ingested.push(offers[0].offerUUID);
    return {};
  };
  await stream.readSse(response({ frames: [": keepalive\n", offerFrame(4, "A", "x1"), "data: null\n"] }).body);
  await settle();
  assert.deepEqual(ingested, ["x1"]);
  assert.equal(stream.seq, 4);
  stream.stop();
});

test("absorbCookies drops deleted cookies and never rewrites an unchanged jar", async () => {
  const stream = newStream();
  const writes = [];
  api.refreshCookies = async (_id, cookies) => {
    writes.push(cookies);
    return {};
  };

  stream.absorbCookies(response({ setCookies: ["sid=v1; Path=/"] })); // same value
  await settle();
  assert.equal(writes.length, 0);

  stream.absorbCookies(response({ setCookies: ["sid=v2; Path=/", "tmp=x"] }));
  await settle();
  assert.equal(writes.length, 1);

  stream.absorbCookies(response({ setCookies: ["tmp=; Max-Age=0"] }));
  await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], [{ name: "sid", value: "v2" }]);
  assert.ok(!stream.jar.has("tmp"));
  stream.stop();
});

test("a failed cookie persist keeps the old fingerprint", async () => {
  const stream = newStream();
  const before = stream.cookieFp;
  api.refreshCookies = async () => {
    throw new Error("POST /cookies -> 503");
  };
  stream.absorbCookies(response({ setCookies: ["sid=v9"] }));
  await settle();
  assert.equal(stream.cookieFp, before);
  stream.stop();
});

test("a stop during the handshake never starts roster/status timers", async () => {
  const stream = newStream({ primary: true });
  let recvCalled = false;
  stream.fetchOpening = async (url) => {
    if (url.includes("/ack")) return response();
    recvCalled = true;
    stream.stop(); // reconcile restarts the stream while /recv is in flight
    return response({ frames: [] });
  };
  let rosterCalls = 0;
  stream.syncRoster = async () => {
    rosterCalls++;
  };
  await stream.connectOnce();
  assert.ok(recvCalled);
  assert.equal(stream.rosterTimer, undefined);
  assert.ok(!stream.statusPolling);
  assert.equal(stream.statusTimer, undefined);
  assert.equal(stream.streamOpened, false);
  assert.equal(rosterCalls, 0);
});

test("status poll forwards only changed rows between full batches", async () => {
  const stream = newStream();
  const sent = [];
  api.statuses = async (_id, rows) => {
    sent.push(rows.map((r) => r.driver_uuid));
    return { data: {} };
  };
  const rows = [
    { driver_uuid: "a", status: "ONLINE", latitude: 0, longitude: 0, heading: null, waypoints: null },
    { driver_uuid: "b", status: "OFFLINE", latitude: 0, longitude: 0, heading: null, waypoints: null },
  ];
  await stream.forwardStatuses(rows); // first send is a full batch
  await stream.forwardStatuses(rows); // nothing changed -> no POST
  await stream.forwardStatuses([{ ...rows[0], status: "EN_ROUTE" }, rows[1]]);
  assert.deepEqual(sent, [["a", "b"], ["a"]]);

  // A failed POST is re-sent on the next poll.
  api.statuses = async () => {
    throw new Error("503");
  };
  await stream.forwardStatuses([{ ...rows[0], status: "ON_TRIP" }, rows[1]]);
  api.statuses = async (_id, batch) => {
    sent.push(batch.map((r) => r.driver_uuid));
    return { data: {} };
  };
  await stream.forwardStatuses([{ ...rows[0], status: "ON_TRIP" }, rows[1]]);
  assert.deepEqual(sent.at(-1), ["a"]);

  // Once the full-sync interval elapses, everyone is sent again.
  stream.lastFullStatusAt = Date.now() - config.statusFullSyncInterval - 1;
  await stream.forwardStatuses([{ ...rows[0], status: "ON_TRIP" }, rows[1]]);
  assert.deepEqual(sent.at(-1), ["a", "b"]);
  stream.stop();
});

test("Fleet Hub 429 backs the status poll off (honouring Retry-After) without the auth path", () => {
  const stream = newStream();
  stream.noteSupplierThrottle({ status: 429, headers: { get: () => "40" } });
  assert.equal(stream.supplierBackoffMs, 40000);
  assert.equal(stream.supplierAuthFails ?? 0, 0);
  const next = stream.nextStatusDelay(true);
  assert.ok(next >= 36000 && next <= 44000);
  stream.noteSupplierThrottle({ status: 404, headers: { get: () => null } }); // not a throttle
  assert.equal(stream.supplierBackoffMs, 40000);
  stream.supplierRecovered();
  assert.equal(stream.supplierBackoffMs, 0);
  stream.stop();
});

// ── Ingest freshness + per-driver superseding ───────────────────────────────

const offerData = (seq, driver, uuid, extra = {}) =>
  JSON.stringify({
    msg: [
      {
        seq,
        type: "push_fleet_unified_offer",
        msg: JSON.stringify({ offers: [{ offerUUID: uuid, driverInfo: { driverUUID: driver }, ...extra }] }),
      },
    ],
  });

/** Run fn with Date.now driven by a fake clock that the stream's sleep advances. */
async function withFakeClock(stream, fn) {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  stream.sleep = async (ms) => {
    now += ms;
  };
  try {
    return await fn({ advance: (ms) => (now += ms), now: () => now });
  } finally {
    Date.now = realNow;
  }
}

test("ingest expiry follows the offer's accept window, bounded to 10-25 s after receipt", () => {
  const t = 1_000_000;
  assert.equal(ingestExpiresAt([{}], t), t + 25000); // unknown: 25 s from receipt
  assert.equal(ingestExpiresAt([{ offerGeneratedAtMs: t, acceptWindowInSeconds: 12 }], t), t + 17000);
  assert.equal(ingestExpiresAt([{ offerGeneratedAtMs: t - 300000 }], t), t + 10000); // skewed/old clock: floor
  assert.equal(ingestExpiresAt([{ offerGeneratedAtMs: t + 600000 }], t), t + 25000); // clock ahead: cap
});

test("a failing ingest is never sent after the offer's accept window", async () => {
  const stream = newStream();
  const sentAt = [];
  await withFakeClock(stream, async ({ now }) => {
    const received = now();
    api.ingest = async () => {
      sentAt.push(Date.now());
      const e = new Error("POST /ingest -> 503");
      e.status = 503;
      throw e;
    };
    stream.handleData(offerData(1, "A", "a1", { offerGeneratedAtMs: received, acceptWindowInSeconds: 15 }));
    await settle();
    const expiresAt = received + 20000;
    assert.ok(sentAt.length >= 2, "retried while fresh");
    assert.ok(sentAt.every((t) => t < expiresAt), "no attempt after the accept window");
    assert.equal(stream.ingestDropped, 1);
    assert.equal(stream.ingestBacklog.length, 0);
  });
  stream.stop();
});

test("a permanent 4xx ingest error is not retried", async () => {
  const stream = newStream();
  let calls = 0;
  api.ingest = async () => {
    calls++;
    const e = new Error("POST /ingest -> 422");
    e.status = 422;
    throw e;
  };
  stream.handleData(offerData(1, "A", "a1"));
  await settle();
  assert.equal(calls, 1);
  assert.equal(stream.ingestDropped, 1);
  stream.stop();
});

test("a driver's new offer is not held behind an older offer sleeping in retry backoff", async () => {
  const stream = newStream();
  stream.sleep = () => new Promise(() => {}); // a backoff that would never end on its own
  const sent = [];
  let healthy = false;
  api.ingest = async (offers) => {
    sent.push(offers[0].offerUUID);
    if (!healthy) throw Object.assign(new Error("POST /ingest -> 502"), { status: 502 });
    return {};
  };
  stream.handleData(offerData(1, "A", "a1"));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, ["a1"]); // failed, now sleeping in backoff

  healthy = true;
  const started = Date.now();
  stream.handleData(offerData(2, "A", "a2"));
  await settle();
  assert.deepEqual(sent, ["a1", "a2"], "the stale a1 is never re-sent after a2");
  assert.ok(Date.now() - started < 100, "a2 went out immediately");
  assert.equal(stream.ingestDropped, 1);
  assert.equal(stream.ingestBacklog.length, 0);
  stream.stop();
});

test("an older offer mid-request is not retried once a newer one for the driver is queued", async () => {
  const stream = newStream();
  const sent = [];
  let failA1;
  api.ingest = async (offers) => {
    const id = offers[0].offerUUID;
    sent.push(id);
    if (id === "a1") await new Promise((_, reject) => (failA1 = reject));
    return {};
  };
  stream.handleData(offerData(1, "A", "a1"));
  await new Promise((r) => setImmediate(r));
  stream.handleData(offerData(2, "A", "a2"));
  failA1(Object.assign(new Error("timeout"), { status: undefined }));
  await settle();
  assert.deepEqual(sent, ["a1", "a2"]);
  assert.equal(stream.ingestDropped, 1);
  stream.stop();
});

// ── jar_version echo + stale_jar ────────────────────────────────────────────

test("reports echo the stream's jar_version", async () => {
  const stream = new RamenStream({ ...session(), jar_version: 7 }, "/ramendca/events");
  stream.sleep = async () => {};
  const seen = {};
  api.refreshCookies = async (_id, _cookies, _expires, version) => {
    seen.cookies = version;
    return {};
  };
  api.needsRelink = async (_id, version) => {
    seen.relink = version;
    return {};
  };
  api.supplierDegraded = async (_id, version) => {
    seen.degraded = version;
    return {};
  };
  stream.absorbCookies(response({ setCookies: ["sid=v2"] }));
  await settle();
  stream.supplierAuthFails = config.supplierFailThreshold;
  await stream.handleSupplierAuthFailure(401);
  await stream.handleStreamAuthFailure(401);
  assert.deepEqual(seen, { cookies: 7, relink: 7, degraded: 7 });
});

test("the api client puts jar_version in the report bodies", async () => {
  const realFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push([url.split("/dispatch")[1], JSON.parse(init.body ?? "null")]);
    return { ok: true, json: async () => ({ data: {} }) };
  };
  try {
    await originalApi.refreshCookies(3, [{ name: "sid", value: "x" }], undefined, 4);
    await originalApi.needsRelink(3, 4);
    await originalApi.supplierDegraded(3, 4);
    await originalApi.needsRelink(3, null);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(bodies, [
    ["/sessions/3/cookies", { cookies: [{ name: "sid", value: "x" }], jar_version: 4 }],
    ["/sessions/3/needs-relink", { jar_version: 4 }],
    ["/sessions/3/supplier-degraded", { jar_version: 4 }],
    ["/sessions/3/needs-relink", {}],
  ]);
});

test("a 409 stale_jar stops cookie writes without advancing the fingerprint", async () => {
  let staleCalls = 0;
  const stream = new RamenStream({ ...session(), jar_version: 1 }, "/ramendca/events", { onStaleJar: () => staleCalls++ });
  const before = stream.cookieFp;
  let writes = 0;
  api.refreshCookies = async () => {
    writes++;
    throw Object.assign(new Error("POST /cookies -> 409"), { status: 409, apiMessage: "stale_jar" });
  };
  stream.absorbCookies(response({ setCookies: ["sid=v2"] }));
  await settle();
  stream.absorbCookies(response({ setCookies: ["sid=v3"] }));
  await settle();
  assert.equal(writes, 1, "no further writes from a replaced jar");
  assert.equal(stream.cookieFp, before);
  assert.equal(stream.jarStale, true);
  assert.equal(staleCalls, 1);
  assert.equal(stream.stopped, false, "keeps streaming until the supervisor swaps it");
  stream.stop();
});

test("a 401 whose needs-relink is refused as stale_jar stops the stream and asks for a restart", async () => {
  let staleCalls = 0;
  const stream = new RamenStream({ ...session(), jar_version: 1 }, "/ramendca/events", { onStaleJar: () => staleCalls++ });
  api.needsRelink = async () => {
    throw Object.assign(new Error("409"), { status: 409, apiMessage: "stale_jar" });
  };
  assert.equal(await stream.handleStreamAuthFailure(401), true);
  assert.equal(stream.stopped, true);
  assert.equal(staleCalls, 1);
});

// ── Status keepalive for the backend's daemon-is-feeding gate ───────────────

test("an idle fleet still posts a keepalive status row well inside the backend's 20 s gate", async () => {
  const stream = newStream();
  const sent = [];
  api.statuses = async (_id, rows) => {
    sent.push(rows.map((r) => r.driver_uuid));
    return { data: {} };
  };
  const rows = [
    { driver_uuid: "a", status: "ONLINE", latitude: 0, longitude: 0, heading: null, waypoints: null },
    { driver_uuid: "b", status: "OFFLINE", latitude: 0, longitude: 0, heading: null, waypoints: null },
  ];
  await stream.forwardStatuses(rows); // full batch
  await stream.forwardStatuses(rows); // unchanged, just posted -> nothing
  assert.equal(sent.length, 1);
  stream.lastStatusPostAt = Date.now() - 8000; // 8 s of no change
  await stream.forwardStatuses(rows);
  assert.deepEqual(sent.at(-1), ["a"], "one unchanged row keeps the gate open");
  stream.stop();
});
