// Co-browse connection layer (docs/28 §2.3-2.5): the second, public-facing listener. It serves ONLY
// a WebSocket upgrade on /cobrowse/ws; every other request is a 404. The internal /login/* listener
// (X-Auth-Secret) is a different server on a different port.
//
// Protocol (frozen in docs/28 §8, extended for fullLogin in §11):
//   client -> server  text  {t:"auth",ticket}  (first, <=5s)  then  {t:"m",k,x,y}  (mouse)
//                           and, for a fullLogin stream only, {t:"k",c} | {t:"k",n}  (keyboard)
//   server -> client  text  {t:"hello",w,h} | {t:"end",reason}      binary = one JPEG frame
// Close codes: 4401 auth refused, 4409 viewer/company already live, 4429 capacity,
//              1008 protocol violation (off-schema / oversize / too fast / binary), 1000 normal end.
//
// Everything that touches Playwright/CDP is injected (`openStream`, `tick`), so this layer is
// unit-tested over a real socket without a browser. Nothing here logs frames or coordinates.

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createJtiStore, deriveKey, loginHash, verifyTicket } from "./cobrowseTicket.js";
import { MAX_AUTH_BYTES, MAX_MSG_BYTES, auditLine, createRateLimiter, parseAuth, parseKey, parseMouse } from "./cobrowseGuard.js";

export const AUTH_WAIT_MS = 5000;
export const IDLE_MS = 60_000;
// A human login has no input while the manager leaves to fetch the code from their mailbox/phone,
// so a 60s idle would kill it mid-flow; give it room (still bounded by the 10-min hard cap).
export const FULL_LOGIN_IDLE_MS = 5 * 60_000;
export const HARD_CAP_MS = 8 * 60_000;
export const FULL_LOGIN_HARD_CAP_MS = 10 * 60_000; // a human types the email and the code (docs/28 §11.2)
const WATCH_MS = 400;
const IDLE_CHECK_MS = 5000;
const BACKPRESSURE_BYTES = 1_000_000;
const CONTRACT_REASONS = new Set(["solved", "timeout", "idle", "cancel", "violation", "error"]);

/**
 * @param {object}   deps
 * @param {string}   deps.secret            UBER_AUTH_SECRET (ticket key is derived from it)
 * @param {string[]} deps.allowedOrigins
 * @param {number}   deps.max               global concurrent viewers
 * @param {function} deps.findPending       (lh) => { loginId, entry } | null  (entry must be in challenge state)
 * @param {function} deps.openStream        ({session, sendFrame, onViolation}) => Promise<stream>
 * @param {function} deps.tick              (session) => Promise<"challenge"|"failed"|step>
 * @param {function} deps.onEnd             (rec, reason) => Promise<void>  login-side effect of an ending stream
 */
export function createCobrowse({ secret, allowedOrigins, max, findPending, openStream, tick, onEnd, audit = console.log, now = Date.now }) {
  const key = deriveKey(secret);
  const jtis = createJtiStore();
  const bySid = new Map();
  const byCompany = new Map();

  const sendJson = (ws, obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  const originAllowed = (origin) => !!origin && allowedOrigins.includes(origin);

  function refuse(ws, code, reason) {
    ws.close(code, reason);
  }

  function admit(ws, origin, text) {
    const ticket = parseAuth(text);
    if (!ticket) return { err: [1008, "bad_auth"] };
    const v = verifyTicket(ticket, { key, nowS: Math.floor(now() / 1000), jtis, origin, allowedOrigins });
    if (!v.ok) return { err: [4401, v.reason] };
    const found = findPending(v.payload.lh);
    if (!found) return { err: [4401, "no_pending"] };
    if (String(found.entry.companyKey) !== String(v.payload.tid)) return { err: [4401, "company_mismatch"] };
    if (bySid.has(v.payload.sid) || byCompany.has(String(v.payload.tid))) return { err: [4409, "already_live"] };
    if (bySid.size >= max) return { err: [4429, "capacity"] };
    return { payload: v.payload, found };
  }

  async function end(rec, reason) {
    if (rec.ended) return;
    rec.ended = true;
    clearInterval(rec.watchTimer);
    clearInterval(rec.idleTimer);
    clearTimeout(rec.capTimer);
    bySid.delete(rec.sid);
    byCompany.delete(rec.companyKey);
    if (CONTRACT_REASONS.has(reason)) sendJson(rec.ws, { t: "end", reason });
    await rec.stream?.stop().catch(() => {}); // screencast stops BEFORE anything else touches the page
    rec.ws.close(1000, CONTRACT_REASONS.has(reason) ? reason : "closed");
    audit(auditLine("cobrowse.closed", { tid: rec.companyKey, uid: rec.uid, durationMs: now() - rec.startedAt, reason, frames: rec.frames }));
    await onEnd(rec, reason).catch(() => {});
  }

  /** Register the viewer synchronously (a racing second one is refused), then start streaming in the background. */
  function open(ws, payload, found) {
    const rec = {
      ws, sid: payload.sid, uid: payload.uid, companyKey: String(payload.tid), loginId: found.loginId, entry: found.entry,
      // Keyboard relay is admitted ONLY for a fullLogin stream (docs/28 §11). In Arkose mode this is
      // false, so any keystroke stays off-schema and closes the socket exactly as before.
      keyboard: !!found.entry?.fullLogin,
      startedAt: now(), lastInputAt: now(), frames: 0, ended: false, stream: null,
    };
    bySid.set(rec.sid, rec);
    byCompany.set(rec.companyKey, rec);
    ws.on("close", () => end(rec, "viewer_closed"));
    launch(rec);
    return rec;
  }

  async function launch(rec) {
    const { ws, entry } = rec;
    try {
      rec.stream = await openStream({
        session: entry.session,
        sendFrame: (buf) => sendFrame(rec, buf),
        onViolation: () => end(rec, "violation"),
      });
      if (rec.ended) return await rec.stream.stop();
      sendJson(ws, { t: "hello", w: rec.stream.w, h: rec.stream.h });
      await rec.stream.start();
      startTimers(rec);
      audit(auditLine("cobrowse.opened", { tid: rec.companyKey, uid: rec.uid }));
    } catch {
      await end(rec, "error");
    }
  }

  function sendFrame(rec, buf) {
    if (rec.ended || rec.ws.readyState !== rec.ws.OPEN || rec.ws.bufferedAmount > BACKPRESSURE_BYTES) return false;
    rec.ws.send(buf, { binary: true });
    rec.frames++;
    return true;
  }

  function startTimers(rec) {
    let busy = false;
    rec.watchTimer = setInterval(async () => {
      if (busy || rec.ended) return;
      busy = true;
      try {
        const r = await tick(rec.entry.session);
        if (r === "failed") await end(rec, "error");
        else if (rec.entry?.fullLogin) {
          // fullLogin (docs/28 §11.2): the human is still working through email / method / OTP, so the
          // stream stays open for every step; only a landed dashboard ends it.
          if (r === "landed") await end(rec, "solved");
        } else if (r !== "challenge") await end(rec, "solved"); // left the challenge: stream closes BEFORE the OTP step
      } catch {
        /* page mid-navigation: next tick */
      } finally {
        busy = false;
      }
    }, WATCH_MS);
    const idleMs = rec.entry?.fullLogin ? FULL_LOGIN_IDLE_MS : IDLE_MS;
    rec.idleTimer = setInterval(() => now() - rec.lastInputAt > idleMs && end(rec, "idle"), IDLE_CHECK_MS);
    rec.capTimer = setTimeout(() => end(rec, "timeout"), rec.entry?.fullLogin ? FULL_LOGIN_HARD_CAP_MS : HARD_CAP_MS);
    for (const t of [rec.watchTimer, rec.idleTimer, rec.capTimer]) t.unref?.();
  }

  function onConnection(ws, req) {
    const origin = req.headers.origin;
    const limiter = createRateLimiter({ now });
    let rec = null;
    let admitting = false;
    const authTimer = setTimeout(() => !rec && !admitting && refuse(ws, 4401, "auth_timeout"), AUTH_WAIT_MS);
    authTimer.unref?.();
    ws.on("close", () => clearTimeout(authTimer));
    ws.on("error", () => {});

    ws.on("message", async (data, isBinary) => {
      const text = isBinary ? null : data.toString("utf8");
      if (text === null) return violate(ws, rec, end);
      if (!rec) {
        if (admitting) return violate(ws, rec, end);
        admitting = true;
        clearTimeout(authTimer);
        const a = admit(ws, origin, text);
        if (a.err) return refuse(ws, ...a.err);
        rec = open(ws, a.payload, a.found);
        return;
      }
      if (!limiter.allow() || data.length > MAX_MSG_BYTES) return violate(ws, rec, end);
      const m = parseMouse(text);
      if (m) {
        rec.lastInputAt = now();
        return void rec.stream?.mouse(m.k, m.x, m.y);
      }
      // Keyboard is accepted only for a fullLogin stream; in Arkose mode it falls through to violate.
      if (rec.keyboard) {
        const k = parseKey(text);
        if (k) {
          rec.lastInputAt = now();
          return void rec.stream?.key(k);
        }
      }
      return violate(ws, rec, end);
    });
  }

  return {
    onConnection,
    originAllowed,
    liveCount: () => bySid.size,
    /** Force-close the live stream of a company (backend cancel / login expiry / solved). */
    async closeCompany(companyKey, reason) {
      const rec = byCompany.get(String(companyKey));
      if (!rec) return false;
      await end(rec, reason);
      return true;
    },
  };
}

function violate(ws, rec, end) {
  if (rec) return end(rec, "violation");
  ws.close(1008, "violation");
}

/** The public listener: HTTP 404 for everything but a WebSocket upgrade on /cobrowse/ws. */
export function createCobrowseServer(cobrowse) {
  const http = createServer((_req, res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_AUTH_BYTES });
  http.on("upgrade", (req, socket, head) => {
    const path = (req.url || "").split("?")[0];
    if (path !== "/cobrowse/ws" || !cobrowse.originAllowed(req.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => cobrowse.onConnection(ws, req));
  });
  return http;
}

export { loginHash };
