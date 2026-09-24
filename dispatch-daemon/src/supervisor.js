// Supervisor: keep one RamenStream running per active fleet session (and RAMEN
// channel). reconcileTick() polls the backend for the session list and
// starts/stops streams to match; index.js owns the process lifecycle.

import { config } from "./config.js";
import { api } from "./api.js";
import { RamenStream, jarFingerprint } from "./stream.js";
import { captureException, captureThrottled } from "./sentry.js";
import { normalizeSession } from "./util.js";

// Keyed by `${sessionId}:${ramenPath}` — one entry per (session × RAMEN channel),
// since Uber pushes offers across several regional channels in parallel.
export const streams = new Map();

// Consecutive session-poll failures; used to suppress transient (deploy-time)
// ECONNREFUSED noise and only alert Sentry on a sustained backend outage.
let sessionPollFailures = 0;
const SESSION_POLL_ALERT_AFTER = 5; // ~5 min at the 60s poll interval

// Gap between starting consecutive NEW sessions in one pass, so a daemon restart
// doesn't fire every company's TLS handshakes through the proxies in one tick.
const START_STAGGER_MS = 100;

function streamKey(sessionId, path) {
  return `${sessionId}:${path}`;
}

/**
 * Validate every row. A malformed row (cookies stored as an object, a socks5 or
 * scheme-less proxy URL, ...) is reported and skipped; it can no longer throw out
 * of reconcile() and stop every company after it — or crash-loop the daemon on start.
 */
function partitionSessions(rows) {
  const valid = [];
  const invalidIds = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const result = normalizeSession(row);
    if (result.ok) {
      valid.push(result.session);
      continue;
    }
    const id = row?.id ?? "?";
    invalidIds.add(Number(id));
    console.error(`session ${id} skipped: ${result.reason}`);
    captureThrottled(`invalid-session:${id}`, new Error(`invalid fleet session row: ${result.reason}`), {
      where: "session_validate",
      sessionId: id,
    });
  }
  return { valid, invalidIds };
}

async function reconcile() {
  let rows, globalProxyUrl;
  try {
    // The backend returns only the companies assigned to THIS shard (it also
    // heartbeats us and rebalances), so no client-side filtering is needed.
    ({ sessions: rows, globalProxyUrl } = await api.sessions());
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

  // Proxy priority: the company's own proxy_url, else the backend's global proxy
  // (the /sessions meta — currently always null), else the daemon's UBER_PROXY_URL
  // env fallback (applied in effectiveProxy below and in the RamenStream constructor).
  const { valid: sessions, invalidIds } = partitionSessions(
    (Array.isArray(rows) ? rows : []).map((s) => (s && typeof s === "object" ? { ...s, proxy_url: s.proxy_url || globalProxyUrl || "" } : s)),
  );

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
    // A row that is currently malformed keeps its last good stream running
    // untouched rather than being torn down for a config we can't apply.
    if (invalidIds.has(sessionId)) continue;

    const proxyChanged = effectiveProxy.has(sessionId) && effectiveProxy.get(sessionId) !== stream.proxyUrl;
    const fpNow = effectiveFp.get(sessionId);
    const cookiesChanged = fpNow !== undefined && fpNow !== stream.cookieFp;

    // A cookie change that MATCHES the primary channel's live fingerprint is the
    // daemon's OWN rolling refresh (the primary absorbed + persisted Uber's rotated
    // session cookie). Adopt it into this (secondary) stream WITHOUT a teardown, so a
    // self-rotation never resets its seq and drops offers in the gap. Only a change the
    // primary's live jar can't match — a fresh browser re-link — restarts the streams.
    if (cookiesChanged && wantedKeys.has(key) && !proxyChanged) {
      const primaryFp = streams.get(streamKey(sessionId, config.ramenPaths[0]))?.cookieFp;
      if (primaryFp !== undefined && fpNow === primaryFp) {
        stream.cookieFp = fpNow; // adopt the primary's rotation; keep the live stream + its seq
        continue;
      }
    }

    if (!wantedKeys.has(key) || proxyChanged || cookiesChanged) {
      const reason = !wantedKeys.has(key) ? "no longer active" : proxyChanged ? "proxy changed" : "cookies changed";
      console.log(`stopping stream ${key} (${reason})`);
      stream.stop();
      streams.delete(key);
    }
  }

  // Start a stream per channel for every active session. Each session is isolated:
  // a throw while building one session's streams is reported and skipped.
  let started = 0;
  for (const session of sessions) {
    const created = startSessionStreams(session);
    if (created.length === 0) continue;
    const delay = started++ * START_STAGGER_MS;
    for (const [key, stream] of created) runStream(key, stream, delay);
  }
}

/** Build (but don't run) the missing streams of one session; all-or-nothing. */
function startSessionStreams(session) {
  const created = [];
  try {
    config.ramenPaths.forEach((path, index) => {
      const key = streamKey(session.id, path);
      if (streams.has(key)) return;
      console.log(`starting stream ${key} (${session.uber_org_uuid})`);
      const stream = new RamenStream(session, path, { primary: index === 0 });
      // Registered synchronously so the next reconcile pass never starts it twice.
      streams.set(key, stream);
      created.push([key, stream]);
    });
    return created;
  } catch (e) {
    for (const [key, stream] of created) {
      stream.stop();
      streams.delete(key);
    }
    console.error(`session ${session.id}: could not start stream: ${e.message}`);
    captureThrottled(`stream-start:${session.id}`, e, { where: "stream_start", sessionId: session.id });
    return [];
  }
}

function runStream(key, stream, delay) {
  const start = () => {
    if (stream.stopped) return; // stopped before its staggered start — nothing to do
    stream.run().catch((e) => {
      console.error(`stream ${key} crashed: ${e.message}`);
      captureException(e, { where: "stream", key });
    });
  };
  if (delay > 0) setTimeout(start, delay);
  else start();
}

// reconcile() is async and the interval doesn't wait for it: a session poll that
// runs long (a slow backend) would let a second pass start while the first is still
// deciding which streams to stop — two passes mutating the same map, each able to
// stop a stream the other just started. One in-flight pass at a time; a skipped
// tick simply happens 60s later.
let reconciling = false;

export async function reconcileTick() {
  if (reconciling) {
    console.warn("reconcile still in flight — skipping this tick");
    return;
  }
  reconciling = true;
  try {
    await reconcile();
  } catch (e) {
    // Never let a stray error reject main() at startup (crash-loop) or surface as
    // an unhandledRejection from the interval: log, report, retry next tick.
    console.error(`reconcile failed: ${e.message}`);
    captureThrottled("reconcile", e, { where: "reconcile" });
  } finally {
    reconciling = false;
  }
}

