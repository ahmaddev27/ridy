// Wires the PersistentSessionManager to the real Playwright driver and the Reidey
// backend: it adopts a context after an interactive login, keeps every company's
// session warm, pushes fresh captures + per-company status to Laravel, and resumes
// saved sessions after a service restart (so a deploy does not force a fresh OTP on
// every company). server.js calls adoptLogin() on a successful sign-in and reads
// statusList() for /sessions; the tick + status loops run for the process lifetime.

import { readdir, readFile, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { config } from "./config.js";
import { PersistentSessionManager, SESSION_STATE, jarFingerprint } from "./sessionManager.js";
import { createWarmDriver, statePath as driverStatePath } from "./warmDriver.js";
import { launchBrowser, newStealthContext } from "./browser.js";
import { scopeCookies } from "./cookieScope.js";
import { registerPasskey } from "./passkey.js";

const driver = createWarmDriver();

async function backendPost(path, body) {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Dispatch-Secret": config.dispatchSecret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`backend ${path} -> ${res.status}`);
  return res.json().catch(() => ({}));
}

async function backendGet(path) {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: { Accept: "application/json", "X-Dispatch-Secret": config.dispatchSecret },
  });
  if (!res.ok) throw new Error(`backend ${path} -> ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body?.data) ? body.data : [];
}

/** Like backendGet but for endpoints whose `data` is an object. */
async function backendGetObject(path) {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: { Accept: "application/json", "X-Dispatch-Secret": config.dispatchSecret },
  });
  if (!res.ok) throw new Error(`backend ${path} -> ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return body?.data && typeof body.data === "object" ? body.data : {};
}

/** Resolves "posted" | "skipped" (nothing to send) | "blocked" (backend refused it, 202). */
async function postCapture(companyKey, cap) {
  if (!cap.orgUuid || !Array.isArray(cap.cookies) || cap.cookies.length === 0) return "skipped";
  const res = await backendPost(`/api/v1/internal/session-browser/${encodeURIComponent(companyKey)}/capture`, {
    uber_org_uuid: cap.orgUuid,
    cookies: cap.cookies,
    supplier_cookies: cap.supplierCookies && cap.supplierCookies.length ? cap.supplierCookies : undefined,
  });
  // The refusal arrives as 202 { data: { status: "blocked", reason } }.
  return res?.data?.status === "blocked" ? "blocked" : "posted";
}

const manager = new PersistentSessionManager({
  driver,
  post: postCapture,
  // Surface needs_otp / down to the admin promptly instead of waiting for the
  // next status tick.
  notify: async () => {
    await pushStatus().catch(() => {});
  },
  renewIntervalMs: config.warmIntervalMs,
  maxSessions: config.maxSessions,
  log: (m) => console.log(`[persistent] ${m}`),
});

async function pushStatus() {
  const browsers = manager.status().map((s) => ({
    tenant_id: Number(s.company),
    state: s.state,
    last_login_at: s.last_login_at ? new Date(s.last_login_at).toISOString() : null,
    last_capture_at: s.last_capture_at ? new Date(s.last_capture_at).toISOString() : null,
    hard_reauth_count: s.hard_reauth_count,
    consecutive_errors: s.consecutive_errors,
  }));
  if (browsers.length === 0) return;
  await backendPost("/api/v1/internal/session-browser/status", { browsers });
}

/** Take over a context that just finished an interactive login (from server.js). */
export async function adoptLogin(companyKey, session, result) {
  // Adopt, then immediately take a proper dual-jar (RAMEN + Fleet Hub) capture and push
  // it. Resolves { captured, reason? }: false when the backend did not accept the capture.
  const outcome = await manager.adoptAndCapture(companyKey, session, {
    orgUuid: result?.org_uuid ?? null,
    cookies: Array.isArray(result?.cookies) ? result.cookies : [],
  });
  const entry = manager.get(companyKey);
  if (entry) entry.proxyUrl = session?.proxyUrl ?? null;
  await pushStatus().catch(() => {});
  if (outcome.captured) schedulePasskeyRegistration(companyKey);
  return outcome;
}

/** Passwordless-login hooks (server.js): the session state and the login-in-progress marker. */
export const sessionState = (companyKey) => manager.stateOf(companyKey);
export const markLoggingIn = (companyKey) => manager.markLoggingIn(companyKey);
export const handleOf = (companyKey) => manager.get(companyKey)?.handle ?? null;
export const markNeedsOtp = (companyKey) => manager.markNeedsOtp(companyKey);
/**
 * Admin force re-link: stop the company's browser whatever its state and delete its saved
 * state file (so a restart does not resurrect the dead session). Resolves the new state.
 */
export async function forceDrop(companyKey) {
  await manager.forceDrop(String(companyKey));
  await unlink(driverStatePath(companyKey)).catch(() => {});
  return SESSION_STATE.NOT_SET_UP;
}
export const liveSessionCount = () => manager.liveCount();

/**
 * Cross-process check for a COLD login: does the BACKEND already hold a live session for the
 * company (the extension or an auto-relink may have connected it since the cold start)? The
 * in-memory manager cannot see that. Fails CLOSED: if the backend cannot be asked, assume yes.
 */
export async function backendHasSession(companyKey, { activeOnly = false } = {}) {
  try {
    const wanted = await backendGet("/api/v1/internal/session-browser/wanted");
    return wanted.some((s) => String(s.tenant_id) === String(companyKey) && (!activeOnly || s.status === "active"));
  } catch {
    return true;
  }
}

// --- Software-passkey registration (dormant: config.passkeyRegister + backend flag) -------
const PASSKEY_SETTLE_MS = 90 * 1000; // let the first keep-warm cookie rotation finish first
const PASSKEY_RETRY_MS = 6 * 60 * 60 * 1000;
const PASSKEY_MAX_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const passkeyAttempts = new Map(); // key -> attempt timestamps (last 24h)
const passkeyDone = new Set(); // registered (this process) - the backend remains the source of truth
const passkeyScheduled = new Set();

function passkeyBackoffActive(key, now = Date.now()) {
  const recent = (passkeyAttempts.get(key) ?? []).filter((t) => now - t < DAY_MS);
  passkeyAttempts.set(key, recent);
  if (recent.length >= PASSKEY_MAX_PER_DAY) return true;
  return recent.length > 0 && now - recent[recent.length - 1] < PASSKEY_RETRY_MS;
}

async function passkeyWanted(key) {
  const path = `/api/v1/internal/session-browser/${encodeURIComponent(key)}/passkey`;
  const state = await backendGetObject(path);
  return state.enabled === true && state.registered !== true;
}

/**
 * Register a software passkey for one company if everything allows it. Never throws and never
 * logs the credential - only a reason. Resolves { status, reason? }.
 */
export async function maybeRegisterPasskey(companyKey) {
  const key = String(companyKey);
  try {
    if (!config.passkeyRegister) return { status: "skipped", reason: "disabled" };
    const entry = manager.get(key);
    if (!entry || entry.state !== SESSION_STATE.ACTIVE) return { status: "skipped", reason: "not_active" };
    if (passkeyDone.has(key)) return { status: "skipped", reason: "registered" };
    if (entry.proxyUrl === undefined) return { status: "skipped", reason: "proxy_unknown" };
    if (passkeyBackoffActive(key)) return { status: "skipped", reason: "backoff" };
    if (!(await passkeyWanted(key))) return { status: "skipped", reason: "backend_declined" };
    passkeyAttempts.get(key).push(Date.now());
    const r = await registerPasskey(key, { cookies: entry.cookies, supplierCookies: entry.supplierCookies, proxyUrl: entry.proxyUrl });
    if (!r.ok) {
      console.warn(`[persistent] passkey ${key} not registered: ${r.reason}`);
      return { status: "failed", reason: r.reason };
    }
    await backendPost(`/api/v1/internal/session-browser/${encodeURIComponent(key)}/passkey`, { credential: r.credential });
    passkeyDone.add(key);
    console.log(`[persistent] passkey ${key} registered`);
    return { status: "registered" };
  } catch (e) {
    console.warn(`[persistent] passkey ${key} error: ${e?.message}`);
    return { status: "failed", reason: "error" };
  }
}

/** Fire-and-forget trigger: waits for the settle delay, de-duplicates per company. */
export function schedulePasskeyRegistration(companyKey, delayMs = PASSKEY_SETTLE_MS) {
  const key = String(companyKey);
  if (!config.passkeyRegister || passkeyScheduled.has(key)) return;
  passkeyScheduled.add(key);
  const timer = setTimeout(() => {
    passkeyScheduled.delete(key);
    void maybeRegisterPasskey(key).catch(() => {});
  }, delayMs);
  timer.unref?.();
}

export function statusList() {
  return manager.status();
}

export function hasLive(companyKey) {
  const e = manager.get(companyKey);
  return e != null && e.state !== SESSION_STATE.DOWN;
}

/**
 * Resume saved sessions after a restart: load each company's storageState, verify
 * it is still logged in with one keep-warm, adopt the live ones, and leave the dead
 * ones in needs_otp for a one-tap re-link. Never throws.
 */
export async function resumeFromDisk() {
  let files = [];
  try {
    files = (await readdir(config.stateDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return; // no saved state yet
  }
  for (const file of files) {
    const companyKey = basename(file, ".json");
    if (config.onlyTenants.length && !config.onlyTenants.includes(companyKey)) continue;
    try {
      if (manager.atCapacity()) {
        console.warn(`[persistent] resume stopped at capacity before ${companyKey}`);
        break;
      }
      const state = JSON.parse(await readFile(join(config.stateDir, file), "utf8"));
      const browser = await launchBrowser();
      const context = await newStealthContext(browser, { storageState: state }, null, companyKey);
      const page = await context.newPage();
      page.setDefaultTimeout(config.stepTimeout);
      await manager.adopt(companyKey, { browser, context, page, createdAt: Date.now() }, {});
      await manager.renew(companyKey); // verifies the saved session; needs_otp if dead
      console.log(`[persistent] resumed ${companyKey}: ${manager.get(companyKey)?.state}`);
      schedulePasskeyRegistration(companyKey);
    } catch (e) {
      console.warn(`[persistent] resume ${companyKey} failed: ${e?.message}`);
    }
  }
  await pushStatus().catch(() => {});
}

/**
 * Open a real browser ALREADY logged in to Uber by injecting the session the
 * company connected on Uber's OWN page (captured by the extension, stored by the
 * backend). No password is ever handled here. renew() then navigates Fleet Hub:
 * dead cookies flip it to needs_otp; a live session warms and feeds the daemon.
 */
async function seedFromSession(companyKey, { cookies, supplierCookies, orgUuid, needsRescue = false, proxyUrl = null }) {
  const browser = await launchBrowser();
  const context = await newStealthContext(browser, {}, proxyUrl, companyKey);
  await context.addCookies(scopeCookies(cookies, supplierCookies));
  const page = await context.newPage();
  page.setDefaultTimeout(config.stepTimeout);
  await manager.adopt(companyKey, { browser, context, page, createdAt: Date.now() }, { orgUuid, cookies });
  // Set before the first renew so a refused stored jar is never posted back unless the rescue rule passes.
  manager.get(companyKey).needsRescue = needsRescue;
  manager.get(companyKey).proxyUrl = proxyUrl; // the passkey registration must use the session's own IP
  manager.setBackendJar(companyKey, { cookies, supplierCookies });
  await manager.renew(companyKey);
}

/** Track the daemon's needs_relink flag; the moment it turns on, run one renew right away. */
async function syncRescue(key, rescue) {
  if (manager.setRescue(key, rescue)) await manager.renew(key);
}

/**
 * Reconcile the live browsers with the backend's "wanted" list (active, connected
 * companies): seed a browser for every one that doesn't have a live browser yet,
 * and CLOSE the browser of any company that dropped out (subscription ended or it
 * was disconnected). This is the whole lifecycle — create on connect, stop on
 * lapse — with no manual step and no password. Never throws.
 */
export function syncFromBackend() {
  // The 60 s loop and the rescue poll can overlap, and a rescue renew can take ~10 s.
  syncInFlight ??= runSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

let syncInFlight = null;

async function runSync() {
  let wanted;
  try {
    wanted = await backendGet("/api/v1/internal/session-browser/wanted");
  } catch (e) {
    console.warn(`[persistent] wanted fetch failed: ${e?.message}`);
    return;
  }
  const want = config.onlyTenants.length
    ? wanted.filter((s) => config.onlyTenants.includes(String(s.tenant_id)))
    : wanted;
  const wantedKeys = new Set(want.map((s) => String(s.tenant_id)));

  for (const s of want) {
    const key = String(s.tenant_id);
    // A dead browser of a still-wanted company is dropped (immediately, then with backoff) and re-seeded below.
    const revivedFrom = await manager.releaseIfDead(key, jarFingerprint(s.cookies, s.supplier_cookies));
    if (manager.has(key)) {
      manager.setBackendJar(key, { cookies: s.cookies, supplierCookies: s.supplier_cookies });
      await syncRescue(key, s.status === "needs_relink");
      continue;
    }
    if (manager.atCapacity()) continue;
    try {
      await seedFromSession(key, { cookies: s.cookies, supplierCookies: s.supplier_cookies, orgUuid: s.uber_org_uuid, needsRescue: s.status === "needs_relink", proxyUrl: s.proxy_url });
      const note = revivedFrom ? `revived ${key} from ${revivedFrom}` : `seeded ${key}`;
      console.log(`[persistent] ${note}: ${manager.get(key)?.state}`);
      schedulePasskeyRegistration(key);
    } catch (e) {
      console.warn(`[persistent] seed ${key} failed: ${e?.message}`);
    }
  }

  for (const key of manager.keys()) {
    if (!wantedKeys.has(key)) {
      console.log(`[persistent] ${key} no longer wanted — closing`);
      await manager.remove(key);
    }
  }
  await pushStatus().catch(() => {});
}

let lastRescueWarnAt = 0;
const lastRescueTriggerAt = new Map();
const RESCUE_RETRY_MS = 10 * 1000;

/** Ask the backend which companies the daemon just flagged; sync at once if one still needs a rescue episode. */
async function pollRescue() {
  let rows;
  try {
    rows = await backendGet("/api/v1/internal/session-browser/rescue");
  } catch (e) {
    if (Date.now() - lastRescueWarnAt > 60 * 1000) {
      lastRescueWarnAt = Date.now();
      console.warn(`[persistent] rescue poll failed: ${e?.message}`);
    }
    return;
  }
  const now = Date.now();
  const pending = rows.map((r) => String(r.tenant_id)).filter((key) => {
    if (config.onlyTenants.length && !config.onlyTenants.includes(key)) return false;
    if (manager.get(key)?.needsRescue) return false;
    // A seed that keeps failing must not relaunch Chromium every poll.
    return now - (lastRescueTriggerAt.get(key) ?? 0) >= RESCUE_RETRY_MS;
  });
  if (pending.length === 0) return;
  for (const key of pending) lastRescueTriggerAt.set(key, now);
  await syncFromBackend();
}

let loops = [];
export function startLoops() {
  loops.push(setInterval(() => manager.tick().catch((e) => console.warn(`[persistent] tick: ${e?.message}`)), config.warmTickMs));
  loops.push(setInterval(() => pushStatus().catch((e) => console.warn(`[persistent] status: ${e?.message}`)), config.statusPushMs));
  loops.push(setInterval(() => syncFromBackend().catch((e) => console.warn(`[persistent] sync: ${e?.message}`)), config.syncIntervalMs));
  loops.push(setInterval(() => pollRescue().catch((e) => console.warn(`[persistent] rescue: ${e?.message}`)), config.rescuePollMs));
  for (const t of loops) t.unref?.();
}

export function stopLoops() {
  for (const t of loops) clearInterval(t);
  loops = [];
}
