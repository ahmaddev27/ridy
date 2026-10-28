// Persistent per-company session manager.
//
// The login flow in browser.js establishes a real, human-authenticated Uber
// session (email/password + OTP) and today hands the cookies to Laravel once,
// then closes the browser. This manager KEEPS that browser context alive, one
// per company, and keeps the session warm 24/7: only a real logged-in browser is
// handed a fresh SIGNED token by Uber (jwt-session 24h, sp-jwt-session 14d), which
// the dispatch daemon cannot refresh on its own. A context that stays open renews
// those tokens in time and re-captures the cookies for the daemon, so the class of
// outage where "the token expired because no browser was open" disappears with no
// human and no always-on device at the operator's side.
//
// What it deliberately does NOT do: pass Uber's periodic HARD re-auth. When Uber
// forces a full re-login it logs this browser out too; the manager marks the
// company needs_otp and asks the operator to relay one OTP through the panel (the
// browser.js login flow). No Uber password is ever stored and the OTP is never
// automated — doing so defeats Uber's own bot defense and gets the account banned.
//
// This module owns ONLY the lifecycle and scheduling; every Playwright call lives
// behind the injected `driver`, so the state machine is unit-tested without a real
// browser or network.

export const SESSION_STATE = {
  NOT_SET_UP: "not_set_up", // no login has ever been established
  LOGGING_IN: "logging_in", // an interactive login (or re-login) is in progress
  ACTIVE: "active", // logged in, warm, feeding the daemon
  NEEDS_OTP: "needs_otp", // Uber forced a re-auth; waiting for the operator's code
  DOWN: "down", // the browser/context is gone (crash) and must be rebuilt
};

/** The states from which a periodic keep-warm should run. */
const WARMABLE = new Set([SESSION_STATE.ACTIVE]);

export class PersistentSessionManager {
  /**
   * @param {object}   deps
   * @param {object}   deps.driver   Playwright adapter:
   *   keepWarm(entry) -> Promise<{ ok:boolean, loggedOut?:boolean, cookies?, supplierCookies?, orgUuid?, tokenExpiries?:{ramen?:number|null, supplier?:number|null}, error?:string }>
   *   close(entry)    -> Promise<void>
   * @param {function} deps.post     async (companyKey, {cookies, supplierCookies, orgUuid, tokenExpiries}) => void — forward a fresh capture to the backend.
   * @param {function} [deps.notify] async (companyKey, reason) => void — alert the operator (e.g. needs_otp).
   * @param {function} [deps.now]    () => number ms (injected for tests).
   * @param {number}   [deps.renewIntervalMs]   keep-warm cadence when nothing is near expiry (default 6h; well under jwt-session's 24h).
   * @param {number}   [deps.renewBeforeExpiryMs] renew early when a token expires within this window (default 12h).
   * @param {number}   [deps.maxSessions]       hard cap on concurrent live contexts on this box.
   * @param {number}   [deps.errorsBeforeDown]  consecutive keep-warm errors that flip a session to DOWN.
   * @param {function} [deps.log]
   */
  constructor({
    driver,
    post,
    notify = async () => {},
    now = () => Date.now(),
    renewIntervalMs = 6 * 60 * 60 * 1000,
    renewBeforeExpiryMs = 12 * 60 * 60 * 1000,
    maxSessions = 20,
    errorsBeforeDown = 3,
    log = () => {},
  }) {
    if (typeof driver?.keepWarm !== "function") throw new Error("driver.keepWarm is required");
    if (typeof post !== "function") throw new Error("post is required");
    this.driver = driver;
    this.post = post;
    this.notify = notify;
    this.now = now;
    this.renewIntervalMs = renewIntervalMs;
    this.renewBeforeExpiryMs = renewBeforeExpiryMs;
    this.maxSessions = maxSessions;
    this.errorsBeforeDown = errorsBeforeDown;
    this.log = log;
    /** @type {Map<string, object>} companyKey -> entry */
    this.sessions = new Map();
  }

  /** How many live contexts are currently held (any state but DOWN/NOT_SET_UP). */
  liveCount() {
    let n = 0;
    for (const e of this.sessions.values()) if (e.state === SESSION_STATE.ACTIVE || e.state === SESSION_STATE.NEEDS_OTP || e.state === SESSION_STATE.LOGGING_IN) n++;
    return n;
  }

  atCapacity() {
    return this.liveCount() >= this.maxSessions;
  }

  get(companyKey) {
    return this.sessions.get(companyKey) ?? null;
  }

  has(companyKey) {
    return this.sessions.has(companyKey);
  }

  /** The company keys currently held (any state). */
  keys() {
    return [...this.sessions.keys()];
  }

  /**
   * Take over a freshly logged-in context (from browser.js) and keep it alive.
   * Replaces any previous entry for the company, closing its old context first.
   */
  async adopt(companyKey, handle, { orgUuid = null, cookies = [], supplierCookies = [], tokenExpiries = {} } = {}) {
    if (!companyKey) throw new Error("companyKey is required");
    const existing = this.sessions.get(companyKey);
    if (existing && existing.handle && existing.handle !== handle) {
      await this.#safeClose(existing);
    }
    if (!existing && this.atCapacity()) {
      throw new Error("at_capacity");
    }
    const t = this.now();
    this.sessions.set(companyKey, {
      companyKey,
      state: SESSION_STATE.ACTIVE,
      handle,
      orgUuid,
      cookies,
      supplierCookies,
      tokenExpiries: { ramen: tokenExpiries.ramen ?? null, supplier: tokenExpiries.supplier ?? null },
      createdAt: existing?.createdAt ?? t,
      lastLoginAt: t,
      lastRenewAt: t,
      lastCaptureAt: t,
      hardReauthCount: existing?.hardReauthCount ?? 0,
      consecutiveErrors: 0,
    });
    this.log(`[${companyKey}] session adopted — active`);
    return this.sessions.get(companyKey);
  }

  /** Mark that an interactive (re-)login is being driven for this company. */
  markLoggingIn(companyKey) {
    const e = this.sessions.get(companyKey);
    if (e) e.state = SESSION_STATE.LOGGING_IN;
  }

  /** Whether a session is due for a keep-warm: by cadence, or because a token nears expiry. */
  isDue(entry, t = this.now()) {
    if (!WARMABLE.has(entry.state)) return false;
    if (t - entry.lastRenewAt >= this.renewIntervalMs) return true;
    const exps = [entry.tokenExpiries.ramen, entry.tokenExpiries.supplier].filter((x) => typeof x === "number");
    return exps.some((exp) => exp - t <= this.renewBeforeExpiryMs);
  }

  /** Run one keep-warm for a single session. Resolves for every outcome; never throws. */
  async renew(companyKey) {
    const entry = this.sessions.get(companyKey);
    if (!entry || !WARMABLE.has(entry.state)) return;
    let r;
    try {
      r = await this.driver.keepWarm(entry);
    } catch (e) {
      r = { ok: false, error: e?.message || "keepwarm_threw" };
    }
    const t = this.now();
    entry.lastRenewAt = t;

    if (r && r.loggedOut) {
      // Uber forced a re-auth: this browser is signed out too. A human must relay
      // one OTP; we never store the password or automate the code.
      entry.state = SESSION_STATE.NEEDS_OTP;
      entry.hardReauthCount += 1;
      entry.consecutiveErrors = 0;
      this.log(`[${companyKey}] signed out by Uber -> needs_otp (hard re-auth #${entry.hardReauthCount})`);
      await this.#safeNotify(companyKey, "needs_otp");
      return;
    }

    if (!r || r.ok === false) {
      entry.consecutiveErrors += 1;
      this.log(`[${companyKey}] keep-warm error (${entry.consecutiveErrors}): ${r?.error ?? "unknown"}`);
      if (entry.consecutiveErrors >= this.errorsBeforeDown) {
        entry.state = SESSION_STATE.DOWN;
        await this.#safeClose(entry);
        await this.#safeNotify(companyKey, "down");
      }
      return;
    }

    // Success: a fresh capture. Update the live jar + expiries and hand it to the backend.
    entry.consecutiveErrors = 0;
    if (Array.isArray(r.cookies)) entry.cookies = r.cookies;
    if (Array.isArray(r.supplierCookies)) entry.supplierCookies = r.supplierCookies;
    if (r.orgUuid) entry.orgUuid = r.orgUuid;
    if (r.tokenExpiries) {
      if ("ramen" in r.tokenExpiries) entry.tokenExpiries.ramen = r.tokenExpiries.ramen;
      if ("supplier" in r.tokenExpiries) entry.tokenExpiries.supplier = r.tokenExpiries.supplier;
    }
    entry.lastCaptureAt = t;
    try {
      await this.post(companyKey, {
        orgUuid: entry.orgUuid,
        cookies: entry.cookies,
        supplierCookies: entry.supplierCookies,
        tokenExpiries: entry.tokenExpiries,
      });
    } catch (e) {
      this.log(`[${companyKey}] post to backend failed: ${e?.message}`);
    }
  }

  /** Keep-warm every due session. Sequential on purpose: bounds peak CPU/RAM on the box. */
  async tick() {
    const t = this.now();
    for (const [companyKey, entry] of this.sessions) {
      if (this.isDue(entry, t)) await this.renew(companyKey);
    }
  }

  /** Remove a company entirely (operator disconnected it): close its context. */
  async remove(companyKey) {
    const entry = this.sessions.get(companyKey);
    if (!entry) return;
    await this.#safeClose(entry);
    this.sessions.delete(companyKey);
  }

  /** The per-company view the admin Session tab renders. No cookie values — status only. */
  status() {
    const t = this.now();
    return [...this.sessions.values()].map((e) => ({
      company: e.companyKey,
      org: e.orgUuid ? String(e.orgUuid).slice(0, 8) : null,
      state: e.state,
      last_login_at: e.lastLoginAt,
      last_capture_at: e.lastCaptureAt,
      token_expiries: { ...e.tokenExpiries },
      uptime_ms: t - e.createdAt,
      hard_reauth_count: e.hardReauthCount,
      consecutive_errors: e.consecutiveErrors,
    }));
  }

  async #safeClose(entry) {
    try {
      await this.driver.close?.(entry);
    } catch (e) {
      this.log(`[${entry.companyKey}] close failed: ${e?.message}`);
    }
  }

  async #safeNotify(companyKey, reason) {
    try {
      await this.notify(companyKey, reason);
    } catch (e) {
      this.log(`[${companyKey}] notify failed: ${e?.message}`);
    }
  }
}
