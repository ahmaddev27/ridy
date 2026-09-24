// Daemon entrypoint: start the supervisor loop and own the process lifecycle
// (graceful shutdown, last-resort crash reporting).

import { config } from "./config.js";
import { inflight } from "./stream.js";
import { streams, reconcileTick } from "./supervisor.js";
import { initSentry, captureException, flush } from "./sentry.js";

// Shutdown budget: stay under Docker's default 10s stop grace period.
const SHUTDOWN_INFLIGHT_WAIT_MS = 4000;
const SHUTDOWN_FLUSH_MS = 2000;

let reconcileTimer;

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
  reconcileTimer = setInterval(reconcileTick, config.sessionPollInterval);
}

// Graceful stop: close the streams, give in-flight offer ingests and cookie
// persists a moment to land (a rotated token lost here means the restart comes
// back on the older jar), flush Sentry, then exit. A second signal forces exit.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log(`\n${signal} received, stopping ${streams.size} stream(s)...`);
  clearInterval(reconcileTimer);
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
