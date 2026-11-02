// Pure input-side guards for the co-browse channel (docs/28 §4): the client may only ever send
// the two fixed message shapes below. Anything else is a violation and the socket is closed.
//   {t:"auth",ticket}                    - the first (and only) pre-auth message
//   {t:"m",k:"move"|"down"|"up",x,y}     - x,y in [0,1]; converted to viewport px here, clamped

export const MAX_MSG_BYTES = 256; // after auth (the ticket message is larger and only allowed before)
export const MAX_AUTH_BYTES = 1024;
export const MAX_MSGS_PER_SEC = 120;

const MOUSE_KINDS = new Set(["move", "down", "up"]);

const sameKeys = (obj, keys) => {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};

function parseObject(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** @returns {string|null} the ticket, or null when the message is not exactly {t:"auth",ticket}. */
export function parseAuth(text) {
  const m = parseObject(text);
  if (!m || !sameKeys(m, ["t", "ticket"]) || m.t !== "auth") return null;
  return typeof m.ticket === "string" && m.ticket.length > 0 ? m.ticket : null;
}

const unit = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** @returns {{k:string,x:number,y:number}|null} null = off-schema. */
export function parseMouse(text) {
  const m = parseObject(text);
  if (!m || !sameKeys(m, ["t", "k", "x", "y"]) || m.t !== "m") return null;
  if (!MOUSE_KINDS.has(m.k) || !unit(m.x) || !unit(m.y)) return null;
  return { k: m.k, x: m.x, y: m.y };
}

/** Normalised [0,1] -> integer viewport pixels, clamped to the viewport. */
export function toViewportPx(x, y, w, h) {
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, Math.round(v * (max - 1))));
  return { px: clamp(x, w), py: clamp(y, h) };
}

/** Fixed-window limiter: allow() is false once more than `limit` calls land inside one window. */
export function createRateLimiter({ limit = MAX_MSGS_PER_SEC, windowMs = 1000, now = Date.now } = {}) {
  let bucket = -1;
  let count = 0;
  return {
    allow() {
      const b = Math.floor(now() / windowMs);
      if (b !== bucket) {
        bucket = b;
        count = 0;
      }
      return ++count <= limit;
    },
  };
}

// The top frame may only ever be on Uber's sign-in surface or the Arkose/FunCaptcha challenge.
const ALLOWED_HOSTS = [/(^|\.)uber\.com$/i, /(^|\.)arkoselabs\.(com|cn)$/i, /(^|\.)funcaptcha\.(com|co)$/i];

export function isAllowedNavUrl(url) {
  if (url === "about:blank") return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** The only fields an audit line may carry: never a frame, a coordinate or a screenshot. */
const AUDIT_FIELDS = ["tid", "uid", "durationMs", "reason", "frames"];

export function auditLine(event, fields = {}) {
  const safe = {};
  for (const k of AUDIT_FIELDS) if (fields[k] !== undefined) safe[k] = fields[k];
  return `[cobrowse-audit] ${JSON.stringify({ event, ...safe, at: new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }) })}`;
}
