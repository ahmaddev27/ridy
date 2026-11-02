// Pure input-side guards for the co-browse channel (docs/28 §4): the client may only ever send
// the fixed message shapes below. Anything else is a violation and the socket is closed.
//   {t:"auth",ticket}                    - the first (and only) pre-auth message
//   {t:"m",k:"move"|"down"|"up",x,y}     - x,y in [0,1]; converted to viewport px here, clamped
//   {t:"k",c:"<one printable char>"}     - fullLogin mode ONLY (docs/28 §11.1): a single character
//   {t:"k",n:"<named editing key>"}      - fullLogin mode ONLY: one whitelisted key (no modifiers)
// Keyboard shapes parse the same everywhere, but the CALLER only dispatches them when the stream is
// in fullLogin mode; in Arkose mode any keystroke stays off-schema (a violation), unchanged.

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

// Named editing keys the client may send in fullLogin mode (docs/28 §11.1). Plain text entry and
// caret/erase editing ONLY — deliberately NO modifier keys, NO function keys, NO browser shortcuts.
// `vk` is the Windows virtual-key code CDP wants for a non-text key.
export const KEY_NAMES = new Map([
  ["Backspace", { key: "Backspace", code: "Backspace", vk: 8 }],
  ["Tab", { key: "Tab", code: "Tab", vk: 9 }],
  ["Enter", { key: "Enter", code: "Enter", vk: 13, text: "\r" }],
  ["End", { key: "End", code: "End", vk: 35 }],
  ["Home", { key: "Home", code: "Home", vk: 36 }],
  ["ArrowLeft", { key: "ArrowLeft", code: "ArrowLeft", vk: 37 }],
  ["ArrowRight", { key: "ArrowRight", code: "ArrowRight", vk: 39 }],
  ["Delete", { key: "Delete", code: "Delete", vk: 46 }],
]);

// A single printable character: one UTF-16 code unit that is not a control char (so letters incl.
// äöü, digits, @ . - _ and the rest of printable BMP pass; C0/C1 controls and DEL do not).
const isPrintableChar = (c) => typeof c === "string" && c.length === 1 && c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f;

/**
 * Keyboard message, fullLogin mode only (docs/28 §11.1). Returns null for anything off-schema, so a
 * malformed or modifier-bearing message is a violation exactly like a bad mouse message.
 *   {t:"k",c:"<one printable char>"} -> {kind:"char", c}
 *   {t:"k",n:"<named editing key>"}  -> {kind:"key", name, key, code, vk}
 * @returns {{kind:"char",c:string}|{kind:"key",name:string,key:string,code:string,vk:number}|null}
 */
export function parseKey(text) {
  const m = parseObject(text);
  if (!m || m.t !== "k") return null;
  if (sameKeys(m, ["t", "c"])) return isPrintableChar(m.c) ? { kind: "char", c: m.c } : null;
  if (sameKeys(m, ["t", "n"]) && typeof m.n === "string" && KEY_NAMES.has(m.n)) return { kind: "key", name: m.n, ...KEY_NAMES.get(m.n) };
  return null;
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
