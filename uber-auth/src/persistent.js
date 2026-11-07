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
import { parseProxyUrl } from "./proxy.js";
import { scopeCookies } from "./cookieScope.js";
import { registerPasskey, registerPasskeyInSession } from "./passkey.js";
import { runHygiene } from "./deviceHygiene.js";
import { attachCobrowseAuthenticator, ATTACH, readSignCount, removeAuthenticator } from "./cobrowsePasskey.js";

const driver = createWarmDriver();

const BACKEND_TIMEOUT_MS = 10_000; // a slow backend must never hang a caller's .finally

async function backendPost(path, body) {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Dispatch-Secret": config.dispatchSecret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
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

/** Resolves "posted" | "skipped" (nothing to send) | "blocked" (backend refused it, 202). */
async function postCapture(companyKey, cap) {
  if (!cap.orgUuid || !Array.isArray(cap.cookies) || cap.cookies.length === 0) return "skipped";
  const res = await backendPost(`/api/v1/internal/session-browser/${encodeURIComponent(companyKey)}/capture`, {
    uber_org_uuid: cap.orgUuid,
    cookies: cap.cookies,
    supplier_cookies: cap.supplierCookies && cap.supplierCookies.length ? cap.supplierCookies : undefined,
  });
  // The refusal arrives as 202 { data: { status: "blocked", reason } }.
  if (res?.data?.status !== "blocked") return "posted";
  // The reason is a short code (autolink_blocked / org_change_requires_connect), never a secret.
  console.warn(`[persistent] ${companyKey} capture refused by backend: ${res.data.reason ?? "unknown"}`);
  return "blocked";
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
  await pushStatus().catch(() => {});
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

const passkeyUrl = (key) => `/api/v1/internal/session-browser/${encodeURIComponent(key)}/passkey`;

// Backend side of the passkey registration (docs/31). The credential only ever goes OUT through
// store(); nothing here reads one back.
const passkeyBackend = {
  async status(key) {
    const res = await fetch(`${config.apiBaseUrl}${passkeyUrl(key)}`, {
      headers: { Accept: "application/json", "X-Dispatch-Secret": config.dispatchSecret },
    });
    if (!res.ok) throw new Error(`passkey status -> ${res.status}`);
    return (await res.json()).data;
  },
  // The company's own residential proxy (the daemon's), from the same "wanted" list that seeds the held browser.
  async proxyUrl(key) {
    const wanted = await backendGet("/api/v1/internal/session-browser/wanted");
    return wanted.find((s) => String(s.tenant_id) === String(key))?.proxy_url ?? null;
  },
  store: (key, body) => backendPost(passkeyUrl(key), body),
  fail: (key, reason) => backendPost(`${passkeyUrl(key)}/failure`, { reason }),
};

/**
 * For the co-browse INJECTION step (next task): the company's decrypted credential, exactly the
 * object CDP `WebAuthn.addCredential` takes ({credentialId, isResidentCredential, rpId,
 * privateKey, userHandle, signCount}), or null (flags off / none / backend unreachable).
 * Gated by UBER_AUTH_PASSKEY_REGISTER here and by the backend flags there. The caller must
 * never log or persist the result.
 */
export async function fetchPasskeyCredential(companyKey) {
  if (!config.passkeyRegister) return null;
  try {
    const res = await fetch(`${config.apiBaseUrl}${passkeyUrl(companyKey)}/credential`, {
      headers: { Accept: "application/json", "X-Dispatch-Secret": config.dispatchSecret },
    });
    return res.ok ? ((await res.json()).data ?? null) : null;
  } catch {
    return null;
  }
}

const cobrowsePasskeyOn = () => config.passkeyRegister && config.passkeyCobrowse;

/** docs/31 Path A, step 1+2: authenticator (+ stored passkey) in the co-browse browser. Never throws. */
export const attachCobrowsePasskey = (session, companyKey) =>
  attachCobrowseAuthenticator(session, String(companyKey), {
    enabled: cobrowsePasskeyOn,
    flags: (k) => passkeyBackend.status(k),
    fetchCredential: fetchPasskeyCredential,
    log: (m) => console.log(`[passkey][cobrowse] ${m}`),
  });

/** docs/31 Path A, step 3: register in the adopted co-browse context, AFTER the login landed. Never throws. */
export const registerPasskeyInCobrowse = (companyKey, session) =>
  registerPasskeyInSession(companyKey, session.context, {
    enabled: cobrowsePasskeyOn,
    manager,
    backend: passkeyBackend,
    log: (m) => console.log(`[passkey][cobrowse] ${m}`),
  });

/**
 * Register a software passkey from a SEPARATE short-lived browser (state-file copy, company
 * proxy); the held browser and the daemon are untouched (flag-gated on both sides, idempotent). Resolves { status }; never throws and never carries the credential.
 */
export const registerPasskeyForCompany = (companyKey) =>
  registerPasskey(companyKey, {
    enabled: () => config.passkeyRegister,
    manager,
    backend: passkeyBackend,
    statePath: driverStatePath,
    log: (m) => console.log(`[passkey] ${m}`),
  });

const HYGIENE_TIMEOUT_MS = 90_000;
const HYGIENE_COOLDOWN_MS = 6 * 3_600_000;
const hygieneRunning = new Set();
const hygieneLastRun = new Map();
const hygieneUrl = (key) => `/api/v1/internal/session-browser/${encodeURIComponent(key)}/device-hygiene`;

// Per-company flag, read like the passkey flags (same endpoint family + secret). Fails CLOSED:
// any error, non-200 or missing endpoint means "off".
async function hygieneCompanyEnabled(key) {
  try {
    const res = await fetch(`${config.apiBaseUrl}${hygieneUrl(key)}`, {
      headers: { Accept: "application/json", "X-Dispatch-Secret": config.dispatchSecret },
    });
    return res.ok && (await res.json()).data?.enabled === true;
  } catch {
    return false;
  }
}

async function hygienePass(key) {
  const log = (m) => console.log(`[hygiene][dry-run] ${key}: ${m}`);
  const ctx = { signatures: config.deviceHygiene.signatures, regions: config.deviceHygiene.regions };
  const guarded = await manager.withBusy(key, async (entry) => {
    const page = await entry.handle.context.newPage(); // a SEPARATE tab; never the renew() page
    try {
      return await runHygiene(page, { ctx, log });
    } finally {
      await page.close?.().catch(() => {});
    }
  });
  if (!guarded.ok) log("skipped: session not active/idle");
  return guarded.ok ? guarded.value : { status: "busy" };
}

/**
 * Device-session hygiene, PHASE A (DRY-RUN): list devices, log what WOULD be signed out. Clicks
 * nothing. Gated by UBER_AUTH_DEVICE_HYGIENE + the company flag, per-company cooldown, in-memory
 * running guard, hard timeout. Resolves { status }; NEVER throws and never touches the
 * capture, jar or daemon.
 */
export async function runDeviceHygiene(companyKey, session) {
  const key = String(companyKey);
  try {
    if (!config.deviceHygiene.enabled) return { status: "disabled" };
    if (!session?.fullLogin) return { status: "not_full_login" };
    if (hygieneRunning.has(key)) return { status: "busy" };
    if (Date.now() - (hygieneLastRun.get(key) ?? 0) < HYGIENE_COOLDOWN_MS) return { status: "cooldown" };
    hygieneRunning.add(key);
    try {
      if (!(await hygieneCompanyEnabled(key))) return { status: "company_disabled" };
      hygieneLastRun.set(key, Date.now());
      let timer;
      const timeout = new Promise((r) => { timer = setTimeout(() => r({ status: "timeout" }), HYGIENE_TIMEOUT_MS); });
      return await Promise.race([hygienePass(key), timeout]).finally(() => clearTimeout(timer));
    } finally {
      hygieneRunning.delete(key);
    }
  } catch (e) {
    console.warn(`[hygiene][dry-run] ${key} failed: ${e?.message}`);
    return { status: "error" };
  }
}

export function statusList() {
  return manager.status();
}

export function hasLive(companyKey) {
  const e = manager.get(companyKey);
  return e != null && e.state !== SESSION_STATE.DOWN;
}

/** True only for a usable proxy URL: an Uber-bound context must never be opened without one. */
function hasProxy(proxyUrl) {
  return Boolean(proxyUrl) && parseProxyUrl(proxyUrl) != null;
}

/** companyKey -> proxy_url for every company the backend still wants (same source as the sync loop). */
async function wantedProxies() {
  const wanted = await backendGet("/api/v1/internal/session-browser/wanted");
  return new Map(wanted.map((s) => [String(s.tenant_id), s.proxy_url ?? null]));
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
  let proxies;
  try {
    proxies = await wantedProxies();
  } catch (e) {
    // Without the proxy list we cannot resume safely: never go direct to Uber. The 60 s sync seeds later.
    console.warn(`[persistent] resume skipped, wanted fetch failed: ${e?.message}`);
    return;
  }
  for (const file of files) {
    const companyKey = basename(file, ".json");
    if (config.onlyTenants.length && !config.onlyTenants.includes(companyKey)) continue;
    if (!proxies.has(companyKey)) {
      console.log(`[persistent] resume ${companyKey} skipped: no longer wanted`);
      continue;
    }
    const proxyUrl = proxies.get(companyKey);
    if (!hasProxy(proxyUrl)) {
      console.warn(`[persistent] ALERT resume ${companyKey} skipped: wanted but has no proxy (never connect to Uber direct)`);
      continue;
    }
    try {
      if (manager.atCapacity()) {
        console.warn(`[persistent] resume stopped at capacity before ${companyKey}`);
        break;
      }
      const state = JSON.parse(await readFile(join(config.stateDir, file), "utf8"));
      const browser = await launchBrowser();
      const context = await newStealthContext(browser, { storageState: state }, proxyUrl, companyKey);
      const page = await context.newPage();
      page.setDefaultTimeout(config.stepTimeout);
      await manager.adopt(companyKey, { browser, context, page, createdAt: Date.now(), proxyUrl }, {});
      await manager.renew(companyKey); // verifies the saved session; needs_otp if dead
      console.log(`[persistent] resumed ${companyKey}: ${manager.get(companyKey)?.state}`);
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
  if (!hasProxy(proxyUrl)) throw new Error("no proxy — refusing to seed a direct Uber connection");
  const browser = await launchBrowser();
  const context = await newStealthContext(browser, {}, proxyUrl, companyKey);
  await context.addCookies(scopeCookies(cookies, supplierCookies));
  const page = await context.newPage();
  page.setDefaultTimeout(config.stepTimeout);
  await manager.adopt(companyKey, { browser, context, page, createdAt: Date.now(), proxyUrl }, { orgUuid, cookies });
  // Set before the first renew so a refused stored jar is never posted back unless the rescue rule passes.
  manager.get(companyKey).needsRescue = needsRescue;
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
    if (!hasProxy(s.proxy_url)) {
      console.warn(`[persistent] ALERT seed ${key} skipped: no proxy (never connect to Uber direct)`);
      continue;
    }
    try {
      await seedFromSession(key, { cookies: s.cookies, supplierCookies: s.supplier_cookies, orgUuid: s.uber_org_uuid, needsRescue: s.status === "needs_relink", proxyUrl: s.proxy_url });
      const note = revivedFrom ? `revived ${key} from ${revivedFrom}` : `seeded ${key}`;
      console.log(`[persistent] ${note}: ${manager.get(key)?.state}`);
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

// Only a genuine passkey miss feeds the breaker; Arkose / blocked / a thrown error say nothing about the key.
const PASSKEY_MISSES = new Set(["timeout", "password"]);

const reloginPasskeyOn = () => config.passkeyRegister && config.passkeyRelogin;

/**
 * Passkey sign-in on the unattended re-login: attach a virtual authenticator to the company's HELD
 * handle and inject the stored passkey. Refuses (-> email path) without the flags or a proxy.
 * Marks `handle.passkeyInjected` only when a credential really went in. Never throws.
 */
export async function attachReloginPasskey(handle, companyKey, proxyUrl) {
  handle.passkeyAttachAborted = false;
  // The guard reflects the context's ACTUAL proxy (recorded when the handle was built), never the request body.
  const actual = handle.proxyUrl;
  const status = await attachCobrowseAuthenticator(handle, String(companyKey), {
    enabled: reloginPasskeyOn,
    proxied: () => hasProxy(actual) && (!proxyUrl || proxyUrl === actual),
    flags: (k) => passkeyBackend.status(k),
    fetchCredential: fetchPasskeyCredential,
    log: (m) => console.log(`[passkey][relogin] ${m}`),
  });
  if (handle.passkeyAttachAborted) {
    // The caller gave up waiting: this late attach must leave nothing behind.
    handle.passkeyAttachAborted = false;
    await removeAuthenticator(handle);
    return false;
  }
  handle.passkeyInjected = status === ATTACH.INJECTED;
  return handle.passkeyInjected;
}

/**
 * Always runs after a relogin attempt that attached an authenticator: report the outcome to the
 * backend (landed -> new signCount, else the breaker counter), then remove the authenticator.
 */
export async function finishReloginPasskey(handle, companyKey) {
  const base = `${passkeyUrl(companyKey)}`;
  try {
    if (handle.passkeyLanded) {
      // An unreadable signCount must not hide a real sign-in: still reset the breaker + record the use.
      const signCount = await readSignCount(handle);
      await backendPost(`${base}/used`, signCount != null ? { signCount } : {});
      console.log(`[passkey][relogin] ${companyKey}: outcome=landed (use recorded)`);
    } else if (handle.passkeyInjected && handle.passkeyTried && PASSKEY_MISSES.has(handle.passkeyOutcome)) {
      await backendPost(`${base}/login-failed`, {});
      console.log(`[passkey][relogin] ${companyKey}: outcome=login-failed (${handle.passkeyOutcome})`);
    } else {
      console.log(`[passkey][relogin] ${companyKey}: outcome=not-counted (${handle.passkeyOutcome ?? "none"})`);
    }
  } catch (e) {
    console.warn(`[passkey][relogin] ${companyKey}: outcome report failed: ${e?.message}`);
  } finally {
    await removeAuthenticator(handle);
    console.log(`[passkey][relogin] ${companyKey}: authenticator removed`);
    handle.passkeyTried = false;
    handle.passkeyLanded = false;
    handle.passkeyOutcome = null;
  }
}
