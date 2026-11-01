// Pure admission rules for /login/start and /login/mfa, kept out of server.js so they
// are unit-tested without a socket or a browser.

/** The persistent-manager state in which a running browser must never be disturbed. */
const ACTIVE = "active";

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
    // A healthy browser is feeding the daemon: a fresh login must not evict or stall it.
    if (stateOf(companyKey) === ACTIVE) {
      return reject(409, { status: "session_active", message: "session_active" });
    }
  }
  return { ok: true, companyKey, password };
}

/** /login/mfa: the code may only be relayed by the company that started the login. */
export function companyMatches(entryCompanyKey, bodyCompanyKey) {
  if (entryCompanyKey == null) return true; // legacy one-shot login, never bound to a company
  return bodyCompanyKey != null && String(bodyCompanyKey) === String(entryCompanyKey);
}

function reject(http, body) {
  return { ok: false, http, body };
}
