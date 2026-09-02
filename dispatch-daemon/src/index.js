// Supervisor loop: keep one RamenStream running per active fleet session.
// Polls the backend for the session list and starts/stops streams to match.

import { config } from "./config.js";
import { api } from "./api.js";
import { RamenStream, jarFingerprint } from "./stream.js";
import { initSentry, captureException, flush } from "./sentry.js";

// Keyed by `${sessionId}:${ramenPath}` — one entry per (session × RAMEN channel),
// since Uber pushes offers across several regional channels in parallel.
const streams = new Map();

// Consecutive session-poll failures; used to suppress transient (deploy-time)
// ECONNREFUSED noise and only alert Sentry on a sustained backend outage.
let sessionPollFailures = 0;
const SESSION_POLL_ALERT_AFTER = 5; // ~5 min at the 60s poll interval

function streamKey(sessionId, path) {
  return `${sessionId}:${path}`;
}

async function reconcile() {
  let sessions, globalProxyUrl;
  try {
    // The backend returns only the companies assigned to THIS shard (it also
    // heartbeats us and rebalances), so no client-side filtering is needed.
    ({ sessions, globalProxyUrl } = await api.sessions());
    sessionPollFailures = 0;
  } catch (e) {
    // A single failure is almost always transient — the backend/Caddy briefly
    // restarting during a deploy (ECONNREFUSED) — and the next poll recovers on
    // its own. Only report to Sentry once failures PERSIST, so a deploy blip
    // doesn't create noise while a real outage still surfaces.
    sessionPollFailures++;
    console.error(`session poll failed (${sessionPollFailures}): ${e.message}`);
    if (sessionPollFailures === SESSION_POLL_ALERT_AFTER) {
      captureException(e, { where: "session_poll", consecutiveFailures: sessionPollFailures });
    }
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

  // Effective proxy per session (per-company → global → env), used to detect
  // when a company's proxy was changed in the admin panel.
  const effectiveProxy = new Map(
    sessions.map((s) => [s.id, s.proxy_url || config.proxyUrl || ""]),
  );

  // Jar fingerprint per session over cookie VALUES so a re-link RESTARTS the stream
  // with the fresh jar — even when the new token has the same cookie COUNT. The old
  // count-only fingerprint missed a value rotation, so a reconnect left the stream
  // stuck on the dead cookies (RAMEN 404) until a manual daemon restart.
  const effectiveFp = new Map(
    sessions.map((s) => [s.id, `${jarFingerprint(s.cookies)}:${jarFingerprint(s.supplier_cookies)}`]),
  );

  // Stop streams whose session is gone, no longer active, OR whose proxy/cookies
  // changed (dropped here and immediately re-created below with the new values —
  // so re-linking or setting a proxy in the panel takes effect with no manual restart).
  for (const [key, stream] of streams) {
    const sessionId = Number(key.split(":")[0]);
    const proxyChanged = effectiveProxy.has(sessionId) && effectiveProxy.get(sessionId) !== stream.proxyUrl;
    const cookiesChanged = effectiveFp.has(sessionId) && effectiveFp.get(sessionId) !== stream.cookieFp;
    if (!wantedKeys.has(key) || proxyChanged || cookiesChanged) {
      const reason = !wantedKeys.has(key) ? "no longer active" : proxyChanged ? "proxy changed" : "cookies changed";
      console.log(`stopping stream ${key} (${reason})`);
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
      stream.run().catch((e) => {
        console.error(`stream ${key} crashed: ${e.message}`);
        captureException(e, { where: "stream", key });
      });
    });
  }
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
