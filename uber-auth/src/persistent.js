// Wires the PersistentSessionManager to the real Playwright driver and the Reidey
// backend: it adopts a context after an interactive login, keeps every company's
// session warm, pushes fresh captures + per-company status to Laravel, and resumes
// saved sessions after a service restart (so a deploy does not force a fresh OTP on
// every company). server.js calls adoptLogin() on a successful sign-in and reads
// statusList() for /sessions; the tick + status loops run for the process lifetime.

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { config } from "./config.js";
import { PersistentSessionManager, SESSION_STATE, jarFingerprint } from "./sessionManager.js";
import { createWarmDriver } from "./warmDriver.js";
import { launchBrowser, newStealthContext } from "./browser.js";
import { scopeCookies } from "./cookieScope.js";

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
  await manager.adopt(companyKey, session, {
    orgUuid: result?.org_uuid ?? null,
    cookies: Array.isArray(result?.cookies) ? result.cookies : [],
  });
  // Immediately take a proper dual-jar (RAMEN + Fleet Hub) capture and push it.
  await manager.renew(companyKey).catch(() => {});
  await pushStatus().catch(() => {});
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
      const context = await newStealthContext(browser, { storageState: state });
      const page = await context.newPage();
      page.setDefaultTimeout(config.stepTimeout);
      await manager.adopt(companyKey, { browser, context, page, createdAt: Date.now() }, {});
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
async function seedFromSession(companyKey, { cookies, supplierCookies, orgUuid, needsRescue = false }) {
  const browser = await launchBrowser();
  const context = await newStealthContext(browser);
  await context.addCookies(scopeCookies(cookies, supplierCookies));
  const page = await context.newPage();
  page.setDefaultTimeout(config.stepTimeout);
  await manager.adopt(companyKey, { browser, context, page, createdAt: Date.now() }, { orgUuid, cookies });
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
    try {
      await seedFromSession(key, { cookies: s.cookies, supplierCookies: s.supplier_cookies, orgUuid: s.uber_org_uuid, needsRescue: s.status === "needs_relink" });
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
