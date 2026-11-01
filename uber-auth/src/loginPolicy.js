// Pure admission rules for /login/start and /login/mfa, kept out of server.js so they
// are unit-tested without a socket or a browser.

/** The persistent-manager state in which a running browser must never be disturbed. */
const ACTIVE = "active";
/** States holding a browser context worth re-authenticating (a retry stays in logging_in). */
const RIDEABLE = new Set(["needs_otp", "logging_in"]);

/**
 * Decide whether /login/start may proceed.
 * @returns {{ok:true, companyKey:string|null, password:string|null}|{ok:false, http:number, body:object}}
 */
export function admitStart(body, { passwordless, stateOf }) {
  const companyKey = body.company_key != null ? String(body.company_key) : null;
  const password = body.password ? String(body.password) : null;

  if (!body.email) return reject(422, { error: "email required" });
  if (!password) {
    // Passwordless is opt-in and only ever for a known company (it feeds the persistent manager).
    if (!passwordless) return reject(422, { error: "email and password required" });
    if (!companyKey) return reject(422, { error: "company_key required" });
    const state = stateOf(companyKey);
    // A healthy browser is feeding the daemon: a fresh login must not evict or stall it.
    if (state === ACTIVE) return reject(409, { status: "session_active", message: "session_active" });
    // Warm re-auth only: there must be a known browser context to ride. A company that was
    // never connected is a COLD login, which Uber's Arkose challenge reliably stops, so it
    // goes through the extension instead (a human is present).
    if (!RIDEABLE.has(state)) return reject(409, { status: "no_session", message: "no_session" });
  }
  return { ok: true, companyKey, password };
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
