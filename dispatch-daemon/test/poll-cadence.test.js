import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.DISPATCH_INGEST_SECRET ??= "test-dispatch-secret";

const { RamenStream } = await import("../src/stream.js");
const { api } = await import("../src/api.js");
const { config } = await import("../src/config.js");
const { streams, reconcileTick, nextPollDelay } = await import("../src/supervisor.js");

// Streams must never touch the network in tests.
RamenStream.prototype.run = async function () {};

const row = (id) => ({ id, uber_org_uuid: `org-${id}-uuid`, cookies: [{ name: "sid", value: `v${id}` }], proxy_url: "", jar_version: 1 });

after(() => {
  for (const stream of streams.values()) stream.stop();
  streams.clear();
});

// Each test file runs in its own process, so the supervisor's poll-cadence state
// starts empty here regardless of the other test files.

test("all companies streaming -> normal poll interval", async () => {
  api.sessions = async () => ({ sessions: [row(1), row(2)], globalProxyUrl: "" });
  await reconcileTick();
  assert.equal(nextPollDelay(), config.sessionPollInterval);
});

test("a company that drops out is polled fast until it returns", async () => {
  // Company 2 vanished from the list (Uber rejected it -> needs_relink): fast poll.
  api.sessions = async () => ({ sessions: [row(1)], globalProxyUrl: "" });
  await reconcileTick();
  assert.equal(nextPollDelay(), config.recoveryPollInterval, "fast poll while a company is recovering");

  // The manager re-linked: company 2 is back in the list -> revert to normal.
  api.sessions = async () => ({ sessions: [row(1), row(2)], globalProxyUrl: "" });
  await reconcileTick();
  assert.equal(nextPollDelay(), config.sessionPollInterval, "normal poll once everyone is back");
});

test("fast poll gives up after the recovery window, even if the company never returns", async () => {
  const saved = config.recoveryPollWindow;
  config.recoveryPollWindow = 1; // ms — expires almost immediately
  try {
    api.sessions = async () => ({ sessions: [row(1), row(2)], globalProxyUrl: "" });
    await reconcileTick();
    api.sessions = async () => ({ sessions: [row(1)], globalProxyUrl: "" }); // 2 drops -> watched, fast
    await reconcileTick();
    assert.equal(nextPollDelay(), config.recoveryPollInterval, "fast poll right after the drop");

    await new Promise((r) => setTimeout(r, 5)); // let the 1 ms watch window elapse
    // Company 2 still has not returned: the watch has expired, so the cadence goes
    // back to normal instead of fast-polling the backend forever.
    api.sessions = async () => ({ sessions: [row(1)], globalProxyUrl: "" });
    await reconcileTick();
    assert.equal(nextPollDelay(), config.sessionPollInterval, "a never-returning company stops the fast poll");
  } finally {
    config.recoveryPollWindow = saved;
  }
});
