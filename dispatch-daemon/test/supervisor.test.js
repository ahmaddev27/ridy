import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.DISPATCH_INGEST_SECRET ??= "test-dispatch-secret";

const { RamenStream } = await import("../src/stream.js");
const { api } = await import("../src/api.js");
const { streams, reconcileTick } = await import("../src/supervisor.js");

// Streams must never touch the network in tests.
RamenStream.prototype.run = async function () {};

const good = (id) => ({ id, uber_org_uuid: `org-${id}-uuid`, cookies: [{ name: "sid", value: `v${id}` }], proxy_url: "" });

after(() => {
  for (const stream of streams.values()) stream.stop();
  streams.clear();
});

test("one malformed session never stops the others from starting", async () => {
  api.sessions = async () => ({
    sessions: [
      { ...good(1), cookies: "not-a-jar" },
      { ...good(2), proxy_url: "socks5://u:p@host:1080" },
      { ...good(3), cookies: { x: { name: "sid", value: "v3" } } }, // object jar → normalized
      good(4),
    ],
    globalProxyUrl: "",
  });

  await reconcileTick();

  const ids = new Set([...streams.keys()].map((k) => k.split(":")[0]));
  assert.deepEqual([...ids].sort(), ["3", "4"]);
});

test("a row that turns malformed keeps its last good stream instead of tearing it down", async () => {
  const before = streams.get("4:/ramendca/events");
  assert.ok(before);
  api.sessions = async () => ({ sessions: [{ ...good(4), proxy_url: "host:8080" }, good(3)], globalProxyUrl: "" });
  await reconcileTick();
  assert.equal(streams.get("4:/ramendca/events"), before);
  assert.equal(before.stopped, false);
});

test("a failing session poll or reconcile error never rejects", async () => {
  api.sessions = async () => {
    throw new Error("ECONNREFUSED");
  };
  await reconcileTick();
  api.sessions = async () => ({ sessions: null, globalProxyUrl: "" });
  await reconcileTick();
  // null session list = nothing active: every stream is stopped, nothing throws.
  assert.equal(streams.size, 0);
});

test("a new jar_version restarts the streams even when the cookies match the primary's rotation", async () => {
  const row = { ...good(5), jar_version: 1 };
  api.sessions = async () => ({ sessions: [row], globalProxyUrl: "" });
  await reconcileTick();
  const before = [...streams.entries()].filter(([k]) => k.startsWith("5:"));
  assert.ok(before.length > 0);

  // Same version, same cookies: nothing restarts.
  await reconcileTick();
  for (const [key, stream] of before) assert.equal(streams.get(key), stream);

  // A reconnect bumped the version (cookie values happen to fingerprint the same).
  api.sessions = async () => ({ sessions: [{ ...row, jar_version: 2 }], globalProxyUrl: "" });
  await reconcileTick();
  for (const [key, stream] of before) {
    assert.equal(stream.stopped, true);
    assert.notEqual(streams.get(key), stream);
    assert.equal(streams.get(key).jarVersion, 2);
  }
});
