// Pure helpers shared by the supervisor and the streams. No I/O and no imports of
// undici/Sentry, so they stay unit-testable in isolation (see test/util.test.js).

/**
 * Normalize a cookie jar coming from the backend into a clean [{name, value}] list.
 * A jar stored as an associative object ({"x": {name, value}}) used to reach the
 * daemon as a JSON object and crash `.map` in the stream constructor; entries
 * without a string name/value are dropped rather than sent to Uber.
 */
export function toCookieList(jar) {
  const list = Array.isArray(jar) ? jar : jar && typeof jar === "object" ? Object.values(jar) : [];
  return list.filter(
    (c) => c && typeof c === "object" && typeof c.name === "string" && c.name !== "" && typeof c.value === "string",
  );
}

/** True for an empty proxy (direct) or an http(s) URL undici's ProxyAgent accepts. */
export function isSupportedProxyUrl(url) {
  if (!url) return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Validate + normalize one backend session row before any stream is built from it,
 * so a single malformed row can never abort the supervisor pass (or crash-loop the
 * daemon at startup) for every other company on the shard.
 *
 * @returns {{ ok: true, session: object } | { ok: false, reason: string }}
 */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== "object" || raw.id === undefined || raw.id === null) {
    return { ok: false, reason: "session row without an id" };
  }
  if (typeof raw.uber_org_uuid !== "string" || raw.uber_org_uuid === "") {
    return { ok: false, reason: "missing uber_org_uuid" };
  }

  const cookies = toCookieList(raw.cookies);
  if (cookies.length === 0) {
    return { ok: false, reason: "no usable cookies" };
  }

  const supplier = toCookieList(raw.supplier_cookies);
  const proxyUrl = typeof raw.proxy_url === "string" ? raw.proxy_url.trim() : "";
  if (!isSupportedProxyUrl(proxyUrl)) {
    return { ok: false, reason: "unsupported proxy_url (only http:// or https:// proxies work)" };
  }

  return {
    ok: true,
    session: { ...raw, cookies, supplier_cookies: supplier.length ? supplier : null, proxy_url: proxyUrl },
  };
}

/**
 * A log-safe description of a proxy URL: protocol + host only, never userinfo.
 * (A regex mask leaked the tail of a password containing '@', because URL parsing
 * splits userinfo at the LAST '@'.)
 */
export function describeProxy(url) {
  if (!url) return "direct (no proxy)";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.username || u.password ? " (auth)" : ""}`;
  } catch {
    return "invalid proxy url";
  }
}

/**
 * "Equal jitter": a random delay in [ms/2, ms]. Spreads retries of many streams
 * behind the same failing proxy/backend so they don't recover in lockstep, and
 * never exceeds the configured ceiling.
 */
export function jitter(ms, random = Math.random) {
  return Math.round(ms * (0.5 + random() * 0.5));
}

/** Parse a Retry-After header (delta-seconds or an HTTP date) into ms; 0 if absent/invalid. */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

/**
 * Next Fleet Hub throttle delay after a 429/5xx/network error: at least double the
 * previous delay (starting from `min`), honour Retry-After, clamp to [min, max].
 */
export function nextThrottleDelay(previousMs, retryAfterMs, min, max) {
  const doubled = previousMs ? previousMs * 2 : min;
  return Math.min(max, Math.max(min, doubled, retryAfterMs || 0));
}

/**
 * Parse one Set-Cookie header. `deleted` is true when the server is removing the
 * cookie (Max-Age<=0, an Expires in the past, or an empty value) — such a cookie
 * must leave the jar rather than be sent back / persisted as an empty value.
 *
 * @returns {{ name: string, value: string, deleted: boolean } | null}
 */
export function parseSetCookie(raw, now = Date.now()) {
  if (typeof raw !== "string") return null;
  const [pair, ...attributes] = raw.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;

  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;

  let deleted = value === "";
  for (const attribute of attributes) {
    const sep = attribute.indexOf("=");
    const key = (sep === -1 ? attribute : attribute.slice(0, sep)).trim().toLowerCase();
    const attrValue = sep === -1 ? "" : attribute.slice(sep + 1).trim();
    if (key === "max-age" && /^-?\d+$/.test(attrValue) && Number(attrValue) <= 0) deleted = true;
    if (key === "expires") {
      const at = Date.parse(attrValue);
      if (Number.isFinite(at) && at <= now) deleted = true;
    }
  }

  return { name, value, deleted };
}

/**
 * Identity of a status row for change detection. location_updated_at is left out on
 * purpose: it ticks on every Uber fix even when nothing the backend acts on moved.
 */
export function statusSignature(row) {
  return JSON.stringify([row.status, row.latitude, row.longitude, row.heading, row.waypoints]);
}

const SENSITIVE_KEY = /cookie|secret|authorization|password|passwd|token|dsn/i;
const REDACTED = "[redacted]";

/**
 * Deep-scrub a Sentry event/breadcrumb: redact values under sensitive keys, strip
 * URL userinfo (proxy credentials), `cookie:` header text, and any literal secret
 * (the dispatch secret) wherever it appears in a string.
 */
export function scrubSensitive(value, secrets = [], depth = 0) {
  if (depth > 20) return typeof value === "object" && value !== null ? REDACTED : value;
  if (typeof value === "string") return scrubString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => scrubSensitive(v, secrets, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) && v !== null && v !== undefined ? REDACTED : scrubSensitive(v, secrets, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubString(text, secrets) {
  let out = text
    .replace(/\/\/[^/\s]*@/g, "//" + REDACTED + "@")
    .replace(/(cookie"?\s*[:=]\s*)[^\n]*/gi, `$1${REDACTED}`);
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join(REDACTED);
  }
  return out;
}
