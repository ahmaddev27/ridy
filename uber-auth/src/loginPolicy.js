// Pure admission rules for /login/start and /login/mfa, kept out of server.js so they
// are unit-tested without a socket or a browser.

import { parseProxyUrl } from "./proxy.js";

/** The persistent-manager state in which a running browser must never be disturbed. */
const ACTIVE = "active";
/** States holding a browser context worth re-authenticating (a retry stays in logging_in). */
const RIDEABLE = new Set(["needs_otp", "logging_in"]);

/**
 * Decide whether /login/start may proceed.
 * @returns {{ok:true, companyKey:string|null, password:string|null, cold?:boolean}|{ok:false, http:number, body:object}}
 */
export function admitStart(body, { passwordless, stateOf, coldEnabled = false }) {
  const companyKey = body.company_key != null ? String(body.company_key) : null;
  const password = body.password ? String(body.password) : null;

  // A fullLogin start (docs/28 §11) has the manager type the email themselves inside the stream,
  // so the backend sends none; every other start still requires it. Eligibility is re-checked in
  // runStartNow (canFullLogin), which 409s a full start that is not a cold co-browse one.
  if (!body.email && body.full !== true) return reject(422, { error: "email required" });
  if (!password) {
    // Passwordless is opt-in and only ever for a known company (it feeds the persistent manager).
    if (!passwordless) return reject(422, { error: "email and password required" });
    if (!companyKey) return reject(422, { error: "company_key required" });
    const state = stateOf(companyKey);
    // A healthy browser is feeding the daemon: a fresh login must not evict or stall it.
    if (state === ACTIVE) return reject(409, { status: "session_active", message: "session_active" });
    // A human-driven full login (cold OR a warm-dead session: needs_otp / down / logging_in /
    // nothing held) gets its OWN fresh browser through the proxy, never the held one.
    if (wantsFresh(body, coldEnabled)) {
      if (!parseProxyUrl(body.proxy_url)) return reject(409, { status: "no_proxy", message: "no_proxy" });
      return { ok: true, companyKey, password, cold: wantsCold(body, state, coldEnabled), fresh: true };
    }
    if (RIDEABLE.has(state)) return { ok: true, companyKey, password, cold: false };
    // Nothing to ride. A COLD first connect (fresh browser through the proxy) is allowed only
    // when explicitly enabled, asked for by the backend, and NOTHING is held for the company
    // (state null): never a dead/odd entry, never an active or logging-in one.
    if (wantsCold(body, state, coldEnabled)) {
      // Never from the VPS datacenter IP: that is the Arkose-prone case and pins the account to it.
      if (!parseProxyUrl(body.proxy_url)) return reject(409, { status: "no_proxy", message: "no_proxy" });
      return { ok: true, companyKey, password, cold: true };
    }
    return reject(409, { status: "no_session", message: "no_session" });
  }
  return { ok: true, companyKey, password, cold: false };
}

/**
 * A fresh-browser full login asked for. A claimed COLD one (body.cold) still needs the cold flag;
 * a warm-dead one needs nothing extra here (canFullLogin + the co-browse flags gate it in server.js).
 */
function wantsFresh(body, coldEnabled) {
  return body.full === true && (body.cold !== true || coldEnabled === true);
}

/** Cold connect asked for: flag on, the caller says cold, and the manager holds nothing at all for the company. */
function wantsCold(body, state, coldEnabled) {
  return coldEnabled === true && body.cold === true && state == null;
}

/**
 * Co-browse preconditions (docs/28 §6), checked before an Arkose challenge may keep the browser
 * open: the backend asked for it, the listener + ticket key + origin list exist, the company has its
 * residential proxy, and the browser is real headed Chrome (never a datacenter-IP / headless stream).
 */
export function canCobrowse({ requested, listening, secret, originsConfigured, proxyUrl, realChrome, display }) {
  return requested === true && !!listening && !!secret && !!originsConfigured && !!parseProxyUrl(proxyUrl) && realChrome === true && !!display;
}

/**
 * fullLogin (docs/28 §11) = the manager drives the whole login in the stream. Admitted only when
 * every co-browse precondition holds (`cobrowseOk` = canCobrowse) AND the start builds a FRESH
 * browser (cold, or replacing a dead session; admitStart already refused an ACTIVE one): the
 * held/riding browser is never the one streamed to a human.
 */
export function canFullLogin({ full, cobrowseOk, fresh }) {
  return full === true && cobrowseOk === true && fresh === true;
}

/** Which slot rule a pending login adopts under: "cold" (empty slot only), "fresh" (may replace a dead session), or null. */
export function adoptMode({ cold, fresh }) {
  if (cold === true) return "cold";
  return fresh === true ? "fresh" : null;
}

/**
 * What the capture of a finished login must check before it adopts into the company's slot.
 * `refuse` = drop it now (409 session_active); `backend` = also ask the backend, fail-closed:
 *   "any"    - cold: the backend must hold no session row at all;
 *   "active" - fresh: the backend must hold no ACTIVE session, whatever the local state.
 * A fresh login replaces a DEAD session (needs_otp / down / logging_in) but NEVER an ACTIVE one.
 * @returns {{refuse:boolean, backend:null|"any"|"active"}}
 */
export function adoptGuard(mode, localState) {
  if (mode === "cold") return { refuse: localState != null, backend: "any" };
  // Fresh always asks the backend too: the daemon streams on UberFleetSession.status, which a
  // dead local browser (needs_otp / down) says nothing about.
  if (mode === "fresh") return { refuse: localState === ACTIVE, backend: "active" };
  return { refuse: false, backend: null };
}

/**
 * Per-company start gate. enter() is SYNCHRONOUS on purpose: called straight after
 * admitStart() with no await in between, so no re-seed can turn the company ACTIVE in the
 * gap. It refuses a second start while one is inside startLogin() (its pending login is not
 * visible yet) and refuses when markLoggingIn() reports the session is ACTIVE.
 */
export function createStartGate({ markLoggingIn }) {
  const inFlight = new Set();
  return {
    enter(companyKey) {
      if (inFlight.has(companyKey)) return reject(409, { status: "start_in_flight", message: "start_in_flight" });
      if (!markLoggingIn(companyKey)) return reject(409, { status: "session_active", message: "session_active" });
      inFlight.add(companyKey);
      return { ok: true };
    },
    leave(companyKey) {
      inFlight.delete(companyKey);
    },
  };
}

/** /login/mfa: the code may only be relayed by the company that started the login. */
export function companyMatches(entryCompanyKey, bodyCompanyKey) {
  if (entryCompanyKey == null) return true; // legacy one-shot login, never bound to a company
  return bodyCompanyKey != null && String(bodyCompanyKey) === String(entryCompanyKey);
}

function reject(http, body) {
  return { ok: false, http, body };
}
