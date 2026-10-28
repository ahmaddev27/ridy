// Daemon entrypoint: start the supervisor loop and own the process lifecycle
// (graceful shutdown, last-resort crash reporting).

import { config } from "./config.js";
import { inflight } from "./stream.js";
import { streams, reconcileTick, nextPollDelay } from "./supervisor.js";
import { startCommandLoop, stopCommandLoop } from "./commands.js";
import { initSentry, captureException, flush } from "./sentry.js";

// Shutdown budget: stay under Docker's default 10s stop grace period.
const SHUTDOWN_INFLIGHT_WAIT_MS = 4000;
const SHUTDOWN_FLUSH_MS = 2000;

let reconcileTimer;
let polling = false;

// Self-scheduling session poll. The delay ADAPTS: nextPollDelay() returns the
// fast recovery interval while a company is down and the normal interval once
// everyone is back — so a re-link lands in seconds without polling fast 24/7.
// A plain setInterval could not change its own period, and would also let a slow
// reconcile overlap the next tick.
function scheduleNextReconcile() {
  reconcileTimer = setTimeout(async () => {
    if (!polling) return;
    await reconcileTick();
    if (polling) scheduleNextReconcile();
  }, nextPollDelay());
  reconcileTimer.unref?.();
}

async function main() {
  initSentry();
  console.log(`Ridy dispatch daemon starting [shard "${config.shardId}"] -> ${config.apiBaseUrl}`);
  // Uber traffic is proxied per-stream (per-company proxy_url, else the global
  // UBER_PROXY_URL); calls back to our own API stay direct.
  console.log(
    config.proxyUrl
      ? "global fallback proxy configured; per-company proxy_url overrides it"
      : "no global proxy — companies without their own proxy_url connect directly (Uber blocks that)",
  );
  await reconcileTick();
  polling = true;
  scheduleNextReconcile();
  // AFTER the first reconcile, so the streams a command needs already exist: a
  // command claimed before its session's stream is up would only report
  // "no live stream" and burn one of its few attempts.
  startCommandLoop();
}

// Graceful stop: close the streams, give in-flight offer ingests and cookie
// persists a moment to land (a rotated token lost here means the restart comes
// back on the older jar), flush Sentry, then exit. A second signal forces exit.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log(`\n${signal} received, stopping ${streams.size} stream(s)...`);
  polling = false;
  clearTimeout(reconcileTimer);
  // Before the streams: the loop must stop asking for work it could no longer
  // execute, and a parked long-poll has to be released so it does not hold the
  // shutdown past Docker's stop grace period.
  stopCommandLoop();
  for (const stream of streams.values()) stream.stop();

  if (inflight.size > 0) {
    console.log(`waiting for ${inflight.size} in-flight backend write(s)...`);
    await Promise.race([
      Promise.allSettled([...inflight]),
      new Promise((r) => setTimeout(r, SHUTDOWN_INFLIGHT_WAIT_MS)),
    ]);
  }
  await flush(SHUTDOWN_FLUSH_MS);
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal).catch(() => process.exit(1));
  });
}

// Report crashes the loop never caught, then let the process restart.
process.on("uncaughtException", async (e) => {
  console.error(`uncaughtException: ${e.message}`);
  captureException(e, { where: "uncaughtException" });
  await flush();
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error(`unhandledRejection: ${reason}`);
  captureException(reason instanceof Error ? reason : new Error(String(reason)), { where: "unhandledRejection" });
});

main().catch(async (e) => {
  console.error(`fatal: ${e.message}`);
  captureException(e, { where: "fatal" });
  await flush();
  process.exit(1);
});
