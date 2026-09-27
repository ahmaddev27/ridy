// Central config, read from the environment so nothing secret is hard-coded.

import { isSupportedProxyUrl } from "./util.js";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Refuse to start if the API base is a remote plaintext-HTTP URL: it would leak
// the shared dispatch secret and the decrypted Uber cookies over the wire.
// Loopback HTTP (localhost / 127.0.0.1 / ::1) is fine for a single-host setup.
function assertSecureApiBase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid RIDY_API_URL: ${url}`);
  }

  if (parsed.protocol === "https:") {
    return url;
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (parsed.protocol === "http:" && isLoopback) {
    return url;
  }

  throw new Error(
    `Refusing to start: RIDY_API_URL must use https:// for a remote host ` +
      `(got "${url}"). Plaintext HTTP is only allowed for loopback addresses. ` +
      `A remote http base leaks the dispatch secret and decrypted cookies.`,
  );
}

// Numeric env settings (ms / counts). A typo such as STATUS_INTERVAL_MS=6s used to
// become NaN, which Node treats as a 1ms timer — every company polling Fleet Hub in
// a tight loop. Fail fast at startup instead of running in a broken state.
function intEnv(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`Invalid ${name}: "${raw}" (expected a number >= ${min})`);
  }
  return Math.floor(value);
}

// Uber hosts must stay https: the session cookies ride these requests through
// third-party residential proxies, so a plaintext override would expose them.
function httpsBase(name, fallback) {
  const url = (process.env[name] || fallback).replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${name}: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing to start: ${name} must use https:// (got "${url}").`);
  }
  return url;
}

function ramenPaths() {
  const paths = (process.env.UBER_RAMEN_PATHS || "/ramendca/events,/ramenphx/events")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0 || paths.some((p) => !p.startsWith("/"))) {
    throw new Error(`Invalid UBER_RAMEN_PATHS: every entry must start with "/"`);
  }
  return paths;
}

export const config = {
  // Ridy Laravel API base, e.g. http://localhost:8090
  apiBaseUrl: assertSecureApiBase(
    (process.env.RIDY_API_URL || "http://localhost:8090").replace(/\/$/, ""),
  ),

  // Shared secret matching backend DISPATCH_INGEST_SECRET.
  dispatchSecret: required("DISPATCH_INGEST_SECRET"),

  // Uber RAMEN dispatch stream host.
  uberDispatchBase: httpsBase("UBER_DISPATCH_BASE_URL", "https://vsdispatch.uber.com"),

  // RAMEN channels. Uber's web client opens several regional channels in
  // parallel (dca = Washington DC, phx = Phoenix) and an offer can arrive on
  // any of them, so we mirror that and open all of them per session. The first
  // is treated as primary (it owns roster sync + cookie rotation); the rest
  // only ingest offers. Override with a comma-separated UBER_RAMEN_PATHS list.
  ramenPaths: ramenPaths(),

  // Uber Fleet Hub host — the driver roster (/api/getDrivers) + live status live here.
  // Uber renamed supplier.uber.com → fleethub.uber.com (Sep 2026); the old host's
  // session no longer resolves, so default to the new one.
  uberSupplierBase: httpsBase("UBER_SUPPLIER_BASE_URL", "https://fleethub.uber.com"),

  // Residential proxy that all Uber traffic is routed through. Uber blocks our
  // datacenter IP (RAMEN 404s, getDrivers returns 0), so a residential exit is
  // required for the daemon to hold streams server-side. Format:
  //   http://user:pass@host:port (http/https proxies only — undici's ProxyAgent
  // does not speak SOCKS). Empty = direct (blocked).
  proxyUrl: (process.env.UBER_PROXY_URL || "").trim(),

  // How often to re-pull the roster (ms). Default 30 min.
  rosterInterval: intEnv("ROSTER_INTERVAL_MS", 1800000, 60000),

  // How often to poll live driver statuses (ms) when everyone is idle. Default 6s.
  statusInterval: intEnv("STATUS_INTERVAL_MS", 6000, 1000),

  // Faster status poll (ms) while ANY driver is engaged (EN_ROUTE/ON_TRIP), so a
  // just-accepted offer's live-map waypoints (the real pickup/drop-off) are picked
  // up within seconds AND the live-map car advances smoothly. Default 3s — near
  // Uber's own ~4-5s location refresh, so we catch each new fix promptly without
  // polling faster than Uber updates (which would just add load for no fresher
  // data). Adaptive: only fast when it matters.
  statusIntervalActive: intEnv("STATUS_INTERVAL_ACTIVE_MS", 3000, 1000),

  // Status polls forward only the drivers whose status/position changed since the
  // last successful send, plus a FULL batch at least this often (ms). The full batch
  // keeps status_synced_at fresh (live map, fleet:check-sync) and the backend's
  // opportunistic stale-offer sweep ticking, while idle polls stop rewriting every
  // driver row. 0 = always send the full batch (the pre-delta behaviour).
  statusFullSyncInterval: intEnv("STATUS_FULL_SYNC_MS", 30000, 0),

  // How often to re-read the active session list from the backend (ms).
  sessionPollInterval: intEnv("SESSION_POLL_INTERVAL_MS", 60000, 5000),

  // Request deadlines (ms). Neither Node's fetch nor undici's has a default
  // timeout, so without these a hung TCP connection through a residential proxy
  // parks the promise forever: a stalled status poll freezes the adaptive chain
  // (statuses stop, every offer reads "Not taken") and a stalled ingest never
  // settles. A timed-out ingest goes to the stream's retry queue; polls and
  // heartbeats simply self-heal on their next cycle.
  apiTimeout: intEnv("API_TIMEOUT_MS", 8000, 1000),
  rosterTimeout: intEnv("ROSTER_TIMEOUT_MS", 15000, 1000),
  statusTimeout: intEnv("STATUS_TIMEOUT_MS", 10000, 1000),
  // The RAMEN handshake + stream open. Bounds the CONNECT phase only — once the
  // body is streaming, streamIdleTimeout takes over (a deadline on the body
  // itself would kill a healthy long-poll).
  handshakeTimeout: intEnv("HANDSHAKE_TIMEOUT_MS", 20000, 1000),

  // Fleet Hub (roster/live-status) degradation. A supplier 401/403 does NOT kill
  // the offer stream (that was a ~4.5h offer outage). Instead the status poll slows
  // to supplierRetryInterval, and only after supplierFailThreshold consecutive
  // failures do we prompt the manager — at most once per supplierDegradedCooldown.
  supplierRetryInterval: intEnv("SUPPLIER_RETRY_MS", 60000, 1000),
  supplierFailThreshold: intEnv("SUPPLIER_FAIL_THRESHOLD", 3, 1),
  supplierDegradedCooldown: intEnv("SUPPLIER_DEGRADED_COOLDOWN_MS", 600000, 0),

  // Idle watchdog for an open stream (ms). A connection that goes quiet WITHOUT
  // closing — a proxy that drops the path but leaves the socket open, a TCP black
  // hole — yields no frame, no error and no reconnect: the daemon looks healthy
  // and delivers nothing. If no frame arrives within this window we abort, which
  // surfaces as a normal stream error and reopens from this.seq on the fast path.
  streamIdleTimeout: intEnv("STREAM_IDLE_TIMEOUT_MS", 90000, 10000),

  // Reconnect backoff bounds (ms).
  reconnectMinDelay: intEnv("RECONNECT_MIN_MS", 2000, 100),
  reconnectMaxDelay: intEnv("RECONNECT_MAX_MS", 60000, 100),
  // Delay before REOPENING a stream that had successfully opened and then ended
  // or was dropped — the normal RAMEN long-poll cycle, or a residential-proxy
  // connection reset. Kept tiny so the blind window between streams is tens of
  // ms: an offer Uber dispatches during the 2s error-backoff would be missed.
  // Exponential backoff (reconnect*Delay) is reserved for real failures (a
  // handshake/HTTP/404 error before the stream opened) and drop storms.
  streamCycleDelay: intEnv("STREAM_CYCLE_MS", 250, 0),

  // Horizontal sharding is DB-driven and admin-controlled: this box identifies
  // itself by a stable shard NAME and the backend returns only the companies
  // assigned to it (auto-balanced across boxes, with failover). One box → leave
  // this "main". More boxes → give each a distinct SHARD_ID.
  shardId: (process.env.SHARD_ID || "main").trim(),

  // Sentry DSN for daemon error tracking. Empty = disabled (no-op).
  sentryDsn: (process.env.SENTRY_DSN || "").trim(),
};

if (config.reconnectMaxDelay < config.reconnectMinDelay) {
  throw new Error("Invalid RECONNECT_MAX_MS: must be >= RECONNECT_MIN_MS");
}
if (!isSupportedProxyUrl(config.proxyUrl)) {
  throw new Error("Invalid UBER_PROXY_URL: only http:// or https:// proxies are supported");
}
