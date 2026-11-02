// Co-browse ticket (docs/28 §2.3): a short-lived, single-use, HMAC-signed grant minted by the
// Laravel backend and presented as the FIRST WebSocket message. Pure functions, no I/O.
//
// Wire format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256(key, base64url(JSON payload)))
// Payload:      { tid, sid, lh, uid?, jti, exp }   (exp = unix SECONDS)
// Key:          HMAC-SHA256(UBER_AUTH_SECRET, "cobrowse-v1")  - domain separated from X-Auth-Secret.
// lh:           first 16 hex chars of sha256(login_id)  - the login_id itself never travels.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const TICKET_MAX_TTL_S = 60;
const CLOCK_SKEW_S = 5;
const LOGIN_HASH_LEN = 16;

const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function deriveKey(secret) {
  return createHmac("sha256", String(secret)).update("cobrowse-v1").digest();
}

export function loginHash(loginId) {
  return createHash("sha256").update(String(loginId)).digest("hex").slice(0, LOGIN_HASH_LEN);
}

const mac = (key, body) => createHmac("sha256", key).update(body).digest();

/** Mint a ticket. The backend owns this in production; here it exists for tests and parity. */
export function signTicket(payload, key) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(mac(key, body))}`;
}

/** One-use registry: a jti is accepted once, then remembered until its own expiry. */
export function createJtiStore() {
  const used = new Map(); // jti -> exp seconds
  return {
    consume(jti, expS, nowS) {
      for (const [id, exp] of used) if (exp + CLOCK_SKEW_S < nowS) used.delete(id);
      if (used.has(jti)) return false;
      used.set(jti, expS);
      return true;
    },
    size: () => used.size,
  };
}

const fail = (reason) => ({ ok: false, reason });

function decode(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    return { body: parts[0], sig: Buffer.from(parts[1], "base64url"), payload: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) };
  } catch {
    return null;
  }
}

function validShape(p) {
  const idOk = (v) => typeof v === "string" || Number.isInteger(v);
  return p && typeof p === "object" && idOk(p.tid) && typeof p.sid === "string" && typeof p.lh === "string" && typeof p.jti === "string" && Number.isFinite(p.exp);
}

/**
 * Verify a ticket. Order matters: signature first (nothing in an unsigned payload is trusted),
 * then expiry, then Origin, and the jti is burned LAST so a rejected attempt never wastes it
 * but an accepted ticket can never be replayed.
 * @returns {{ok:true, payload:object}|{ok:false, reason:string}}
 */
export function verifyTicket(token, { key, nowS, jtis, origin, allowedOrigins }) {
  const t = decode(token);
  if (!t || !validShape(t.payload)) return fail("bad_ticket");
  const expected = mac(key, t.body);
  if (t.sig.length !== expected.length || !timingSafeEqual(t.sig, expected)) return fail("bad_signature");
  const { exp, jti } = t.payload;
  if (exp < nowS) return fail("expired");
  if (exp - nowS > TICKET_MAX_TTL_S + CLOCK_SKEW_S) return fail("ttl_too_long");
  if (!origin || !allowedOrigins.includes(origin)) return fail("origin");
  if (!jtis.consume(jti, exp, nowS)) return fail("reused");
  return { ok: true, payload: t.payload };
}
