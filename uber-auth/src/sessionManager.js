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

import { createHash } from "node:crypto";

/** Order-independent digest of both jars' {name,value} pairs. */
export function jarFingerprint(cookies, supplierCookies) {
  const lines = [];
  for (const [tag, list] of [["r", cookies], ["s", supplierCookies]]) {
    for (const c of Array.isArray(list) ? list : []) lines.push(`${tag}:${c?.name}=${c?.value}`);
  }
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

export const SESSION_STATE = {
  NOT_SET_UP: "not_set_up", // no login has ever been established
  LOGGING_IN: "logging_in", // an interactive login (or re-login) is in progress
  ACTIVE: "active", // logged in, warm, feeding the daemon
  NEEDS_OTP: "needs_otp", // Uber forced a re-auth; waiting for the operator's code
  DOWN: "down", // the browser/context is gone (crash) and must be rebuilt
};

/** The states from which a periodic keep-warm should run. */
const WARMABLE = new Set([SESSION_STATE.ACTIVE]);

const fmtExp = (ms) => (typeof ms === "number" ? new Date(ms).toISOString().slice(0, 16) + "Z" : "?");

/** Rescue mode applies until its post budget for the episode is spent. */
const rescueActive = (entry) => !!entry.needsRescue && !entry.rescueGaveUp;

/** Posts allowed per rescue episode: each one re-activates the backend session and can re-notify the manager. */
const MAX_RESCUE_POSTS = 2;

/** A company that dies again within REVIVE_RESET_MS of a revive waits these gaps (the last one repeats). */
const REVIVE_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const REVIVE_RESET_MS = 60 * 60 * 1000;
/** A NEEDS_OTP browser is re-seeded from a NEW jar at most this often. */
const NEEDS_OTP_REVIVE_GAP_MS = 5 * 60 * 1000;

export class PersistentSessionManager {
  /**
   * @param {object}   deps
   * @param {object}   deps.driver   Playwright adapter:
   *   keepWarm(entry) -> Promise<{ ok:boolean, loggedOut?:boolean, cookies?, supplierCookies?, orgUuid?, tokenExpiries?:{ramen?:number|null, supplier?:number|null}, error?:string }>
   *   close(entry)    -> Promise<void>
   * @param {function} deps.post     async (companyKey, {cookies, supplierCookies, orgUuid, tokenExpiries}) => "posted"|"skipped"|"blocked" — forward a fresh capture to the backend. Only "skipped"/"blocked" mean it was NOT accepted.
   * @param {function} [deps.notify] async (companyKey, reason) => void — alert the operator (e.g. needs_otp).
   * @param {function} [deps.now]    () => number ms (injected for tests).
   * @param {number}   [deps.renewIntervalMs]   keep-warm cadence (default 1h; well under jwt-session's 24h).
   * @param {number}   [deps.rescueIntervalMs] cadence while the daemon flagged the company needs_relink (default 10 min).
   * @param {number}   [deps.maxSessions]       hard cap on concurrent live contexts on this box.
   * @param {number}   [deps.errorsBeforeDown]  consecutive keep-warm errors that flip a session to DOWN.
   * @param {function} [deps.log]
   */
  constructor({
    driver,
    post,
    notify = async () => {},
    now = () => Date.now(),
    renewIntervalMs = 60 * 60 * 1000,
    rescueIntervalMs = 10 * 60 * 1000,
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
    this.rescueIntervalMs = rescueIntervalMs;
    this.maxSessions = maxSessions;
    this.errorsBeforeDown = errorsBeforeDown;
    this.log = log;
    /** @type {Map<string, object>} companyKey -> entry */
    this.sessions = new Map();
    /** @type {Map<string, {at:number, count:number}>} companyKey -> last release time + consecutive quick releases */
    this.revives = new Map();
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
      lastJarFp: jarFingerprint(cookies, supplierCookies),
      backendJar: null,
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

  /** Whether a session is due for a keep-warm: strictly by cadence (hourly; 10 min in rescue mode). */
  isDue(entry, t = this.now()) {
    const interval = rescueActive(entry) ? this.rescueIntervalMs : this.renewIntervalMs;
    return WARMABLE.has(entry.state) && t - entry.lastRenewAt >= interval;
  }

  /** Run one keep-warm for a single session. Resolves for every outcome; never throws. */
  async renew(companyKey) {
    const entry = this.sessions.get(companyKey);
    if (!entry || !WARMABLE.has(entry.state)) return;
    let r;
    try {
      r = await this.driver.keepWarm(entry, { inject: !rescueActive(entry) });
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

    // Success: the daemon's copy is superseded the moment Uber rotates anything
    // during this visit, so post iff the captured jar differs from the one this
    // browser started from (the injected backend jar, else the last posted one).
    entry.consecutiveErrors = 0;
    const before = { ...entry.tokenExpiries };
    const startedFrom = this.#startingFingerprint(entry);
    if (Array.isArray(r.cookies)) entry.cookies = r.cookies;
    if (Array.isArray(r.supplierCookies)) entry.supplierCookies = r.supplierCookies;
    // A scraped org may fill a missing one, never replace a known one (an org change needs a manual Connect).
    if (r.orgUuid && !entry.orgUuid) entry.orgUuid = r.orgUuid;
    if (r.tokenExpiries) {
      if ("ramen" in r.tokenExpiries) entry.tokenExpiries.ramen = r.tokenExpiries.ramen;
      if ("supplier" in r.tokenExpiries) entry.tokenExpiries.supplier = r.tokenExpiries.supplier;
    }
    if (rescueActive(entry)) return this.#rescue(companyKey, entry, r, t);
    if (jarFingerprint(entry.cookies, entry.supplierCookies) === startedFrom) {
      this.log(`[${companyKey}] renewed: unchanged`);
      return;
    }
    // Posted under the KNOWN org (above), so a page that never shows the org
    // cannot get every capture refused as an org change.
    const outcome = await this.#postCapture(companyKey, entry);
    if (outcome === "posted") entry.lastCaptureAt = t;
    const exps = entry.tokenExpiries;
    this.log(
      `[${companyKey}] renewed: ${outcome} (jar changed; ramen exp ${fmtExp(before.ramen)} → ${fmtExp(exps.ramen)}, ` +
        `supplier exp ${fmtExp(before.supplier)} → ${fmtExp(exps.supplier)})`,
    );
  }

  /** What the browser's jar is compared against: what was injected, else the last posted/seeded jar. */
  #startingFingerprint(entry) {
    const j = entry.backendJar;
    return j ? jarFingerprint(j.cookies, j.supplierCookies) : entry.lastJarFp;
  }

  /**
   * Daemon flagged needs_relink: hand over the jar this browser just loaded the
   * dispatch host with (a sign-out already went to NEEDS_OTP above), expiry moved
   * or not — what a manager's relink does. Whether the dispatch page proved the
   * org is logged, not required: it is not known to print it, and a wrong guess
   * costs at most MAX_RESCUE_POSTS re-flags.
   */
  async #rescue(companyKey, entry, r, t) {
    const outcome = await this.#postCapture(companyKey, entry);
    if (outcome === "posted") entry.lastCaptureAt = t;
    this.log(`[${companyKey}] rescue: ${outcome}${r.orgVerified ? " (org seen on the page)" : ""}`);
    if (outcome !== "posted") return;
    entry.rescuePosts = (entry.rescuePosts ?? 0) + 1;
    if (entry.rescuePosts >= MAX_RESCUE_POSTS) {
      entry.rescueGaveUp = true;
      this.log(`[${companyKey}] rescue: giving up after ${MAX_RESCUE_POSTS} attempts — needs the manager`);
    }
  }

  /** Forward the jar; resolves "posted" | "skipped" | "blocked" | "failed", never throws. */
  async #postCapture(companyKey, entry) {
    try {
      const out = await this.post(companyKey, {
        orgUuid: entry.orgUuid,
        cookies: entry.cookies,
        supplierCookies: entry.supplierCookies,
        tokenExpiries: entry.tokenExpiries,
      });
      if (out === "skipped" || out === "blocked") return out;
      this.#markPosted(companyKey, entry);
      return "posted";
    } catch (e) {
      this.log(`[${companyKey}] post to backend failed: ${e?.message}`);
      return "failed";
    }
  }

  /** The backend now holds this jar: it is the new comparison base, and a healthy revive loop is over. */
  #markPosted(companyKey, entry) {
    entry.lastJarFp = jarFingerprint(entry.cookies, entry.supplierCookies);
    entry.backendJar = { cookies: entry.cookies, supplierCookies: entry.supplierCookies };
    this.revives.delete(companyKey);
  }

  /** Remember the newest jar the backend (= the daemon) holds, to inject before the next visit. */
  setBackendJar(companyKey, { cookies, supplierCookies } = {}) {
    const entry = this.sessions.get(companyKey);
    if (entry) entry.backendJar = { cookies: cookies ?? [], supplierCookies: supplierCookies ?? [] };
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

  /**
   * Drop a DOWN / NEEDS_OTP entry so the caller can re-seed it from the backend's
   * newest jar. Resolves the state it was in, or null when nothing was released.
   *  - NEEDS_OTP: only when the wanted row's jar (`rowFingerprint`) differs from the
   *    one this entry was seeded/last injected with. The same dead jar would only hit
   *    Uber's login page again; a new one means a relink or a daemon rotation.
   *  - DOWN (transient: network/Chromium): immediately the first time, then a
   *    1 -> 5 -> 15 min backoff if it keeps dying; reset by a successful post or
   *    an hour without a release.
   */
  async releaseIfDead(companyKey, rowFingerprint = null) {
    const entry = this.sessions.get(companyKey);
    if (entry?.state === SESSION_STATE.NEEDS_OTP) {
      if (!rowFingerprint || rowFingerprint === this.#startingFingerprint(entry)) return null;
      // The daemon rotates its jar often; a browser that keeps landing on the login
      // page with each new one must not relaunch Chromium on every rotation.
      const last = this.revives.get(companyKey)?.at;
      if (last !== undefined && this.now() - last < NEEDS_OTP_REVIVE_GAP_MS) return null;
      this.revives.set(companyKey, { at: this.now(), count: 1 });
    } else if (entry?.state !== SESSION_STATE.DOWN || !this.#downBackoffElapsed(companyKey)) {
      return null;
    }
    const state = entry.state;
    await this.remove(companyKey);
    return state;
  }

  /** DOWN revive gate; records the release when it opens. */
  #downBackoffElapsed(companyKey) {
    const t = this.now();
    let rec = this.revives.get(companyKey);
    if (rec && t - rec.at >= REVIVE_RESET_MS) rec = undefined;
    const wait = rec ? REVIVE_BACKOFF_MS[Math.min(rec.count - 1, REVIVE_BACKOFF_MS.length - 1)] : 0;
    if (rec && t - rec.at < wait) return false;
    this.revives.set(companyKey, { at: t, count: (rec?.count ?? 0) + 1 });
    return true;
  }

  /**
   * Set the daemon's needs_relink flag for a held company. Returns true when a
   * rescue episode just started (false -> true); leaving rescue resets the budget.
   */
  setRescue(companyKey, on) {
    const entry = this.sessions.get(companyKey);
    if (!entry) return false;
    const started = on && !entry.needsRescue;
    entry.needsRescue = on;
    if (!on) {
      entry.rescuePosts = 0;
      entry.rescueGaveUp = false;
    }
    return started;
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
