// Supervisor loop: keep one RamenStream running per active fleet session.
// Polls the backend for the session list and starts/stops streams to match.

import { config } from "./config.js";
import { api } from "./api.js";
import { RamenStream } from "./stream.js";

// Keyed by `${sessionId}:${ramenPath}` — one entry per (session × RAMEN channel),
// since Uber pushes offers across several regional channels in parallel.
const streams = new Map();

function streamKey(sessionId, path) {
  return `${sessionId}:${path}`;
}

async function reconcile() {
  let sessions, globalProxyUrl;
  try {
    ({ sessions, globalProxyUrl } = await api.sessions());
  } catch (e) {
    console.error(`session poll failed: ${e.message}`);
    return;
  }

  // Proxy priority: the company's own proxy_url, else the super-admin global
  // proxy (from settings), else the daemon's UBER_PROXY_URL env fallback.
  for (const s of sessions) {
    s.proxy_url = s.proxy_url || globalProxyUrl || "";
  }

  const wantedKeys = new Set(
    sessions.flatMap((s) => config.ramenPaths.map((p) => streamKey(s.id, p))),
  );

  // Stop streams whose session is gone / no longer active.
  for (const [key, stream] of streams) {
    if (!wantedKeys.has(key)) {
      console.log(`stopping stream ${key} (no longer active)`);
      stream.stop();
      streams.delete(key);
    }
  }

  // Start a stream per channel for every active session.
  for (const session of sessions) {
    config.ramenPaths.forEach((path, index) => {
      const key = streamKey(session.id, path);
      if (streams.has(key)) return;
      console.log(`starting stream ${key} (${session.uber_org_uuid})`);
      const stream = new RamenStream(session, path, { primary: index === 0 });
      streams.set(key, stream);
      stream.run().catch((e) => console.error(`stream ${key} crashed: ${e.message}`));
    });
  }
}

async function main() {
  console.log(`Ridy dispatch daemon starting -> ${config.apiBaseUrl}`);
  // Uber traffic is proxied per-stream (per-company proxy_url, else the global
  // UBER_PROXY_URL); calls back to our own API stay direct.
  console.log(
    config.proxyUrl
      ? "global fallback proxy configured; per-company proxy_url overrides it"
      : "no global proxy — companies without their own proxy_url connect directly (Uber blocks that)",
  );
  await reconcile();
  setInterval(reconcile, config.sessionPollInterval);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} received, stopping ${streams.size} stream(s)...`);
    for (const stream of streams.values()) stream.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`fatal: ${e.message}`);
  process.exit(1);
});
