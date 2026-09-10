// Central config, read from the environment so nothing secret is hard-coded.

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

export const config = {
  // Ridy Laravel API base, e.g. http://localhost:8090
  apiBaseUrl: assertSecureApiBase(
    (process.env.RIDY_API_URL || "http://localhost:8090").replace(/\/$/, ""),
  ),

  // Shared secret matching backend DISPATCH_INGEST_SECRET.
  dispatchSecret: required("DISPATCH_INGEST_SECRET"),

  // Uber RAMEN dispatch stream host.
  uberDispatchBase: (process.env.UBER_DISPATCH_BASE_URL || "https://vsdispatch.uber.com").replace(/\/$/, ""),

  // RAMEN channels. Uber's web client opens several regional channels in
  // parallel (dca = Washington DC, phx = Phoenix) and an offer can arrive on
  // any of them, so we mirror that and open all of them per session. The first
  // is treated as primary (it owns roster sync + cookie rotation); the rest
  // only ingest offers. Override with a comma-separated UBER_RAMEN_PATHS list.
  ramenPaths: (process.env.UBER_RAMEN_PATHS || "/ramendca/events,/ramenphx/events")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean),

  // Uber Fleet Hub host — the driver roster (/api/getDrivers) + live status live here.
  // Uber renamed supplier.uber.com → fleethub.uber.com (Sep 2026); the old host's
  // session no longer resolves, so default to the new one.
  uberSupplierBase: (process.env.UBER_SUPPLIER_BASE_URL || "https://fleethub.uber.com").replace(/\/$/, ""),

  // Residential proxy that all Uber traffic is routed through. Uber blocks our
  // datacenter IP (RAMEN 404s, getDrivers returns 0), so a residential exit is
  // required for the daemon to hold streams server-side. Format:
  //   http://user:pass@host:port  (or socks5://…). Empty = direct (blocked).
  proxyUrl: process.env.UBER_PROXY_URL || "",

  // How often to re-pull the roster (ms). Default 30 min.
  rosterInterval: Number(process.env.ROSTER_INTERVAL_MS || 1800000),

  // How often to poll live driver statuses (ms) when everyone is idle. Default 6s.
  statusInterval: Number(process.env.STATUS_INTERVAL_MS || 6000),

  // Faster status poll (ms) while ANY driver is engaged (EN_ROUTE/ON_TRIP), so a
  // just-accepted offer's live-map waypoints (the real pickup/drop-off) are picked
  // up within seconds AND the live-map car advances smoothly. Default 3s — near
  // Uber's own ~4-5s location refresh, so we catch each new fix promptly without
  // polling faster than Uber updates (which would just add load for no fresher
  // data). Adaptive: only fast when it matters.
  statusIntervalActive: Number(process.env.STATUS_INTERVAL_ACTIVE_MS || 3000),

  // How often to re-read the active session list from the backend (ms).
  sessionPollInterval: Number(process.env.SESSION_POLL_INTERVAL_MS || 60000),

  // Request deadlines (ms). Neither Node's fetch nor undici's has a default
  // timeout, so without these a hung TCP connection through a residential proxy
  // parks the promise forever: a stalled status poll freezes the adaptive chain
  // (statuses stop, every offer reads "Not taken") and a stalled ingest blocks
  // the SSE read loop. Every caller already treats a rejection as retryable, so
  // a timeout self-heals on the next cycle.
  apiTimeout: Number(process.env.API_TIMEOUT_MS || 8000),
  rosterTimeout: Number(process.env.ROSTER_TIMEOUT_MS || 15000),
  statusTimeout: Number(process.env.STATUS_TIMEOUT_MS || 10000),
  // The RAMEN handshake + stream open. Bounds the CONNECT phase only — once the
  // body is streaming, streamIdleTimeout takes over (a deadline on the body
  // itself would kill a healthy long-poll).
  handshakeTimeout: Number(process.env.HANDSHAKE_TIMEOUT_MS || 20000),

  // Idle watchdog for an open stream (ms). A connection that goes quiet WITHOUT
  // closing — a proxy that drops the path but leaves the socket open, a TCP black
  // hole — yields no frame, no error and no reconnect: the daemon looks healthy
  // and delivers nothing. If no frame arrives within this window we abort, which
  // surfaces as a normal stream error and reopens from this.seq on the fast path.
  streamIdleTimeout: Number(process.env.STREAM_IDLE_TIMEOUT_MS || 90000),

  // Reconnect backoff bounds (ms).
  reconnectMinDelay: Number(process.env.RECONNECT_MIN_MS || 2000),
  reconnectMaxDelay: Number(process.env.RECONNECT_MAX_MS || 60000),
  // Delay before REOPENING a stream that had successfully opened and then ended
  // or was dropped — the normal RAMEN long-poll cycle, or a residential-proxy
  // connection reset. Kept tiny so the blind window between streams is tens of
  // ms: an offer Uber dispatches during the 2s error-backoff would be missed.
  // Exponential backoff (reconnect*Delay) is reserved for real failures (a
  // handshake/HTTP/404 error before the stream opened) and drop storms.
  streamCycleDelay: Number(process.env.STREAM_CYCLE_MS || 250),

  // Horizontal sharding is DB-driven and admin-controlled: this box identifies
  // itself by a stable shard NAME and the backend returns only the companies
  // assigned to it (auto-balanced across boxes, with failover). One box → leave
  // this "main". More boxes → give each a distinct SHARD_ID.
  shardId: (process.env.SHARD_ID || "main").trim(),

  // Sentry DSN for daemon error tracking. Empty = disabled (no-op).
  sentryDsn: (process.env.SENTRY_DSN || "").trim(),
};
