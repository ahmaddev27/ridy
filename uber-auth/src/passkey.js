// Software-passkey REGISTRATION on a company's Uber account (docs/31). OFF unless
// UBER_AUTH_PASSKEY_REGISTER=1 AND the backend says the company is enabled.
//
// Safety model (the owner's constraints), reworked after the live test:
//  * Registering INSIDE the held persistent-session browser got the live session signed out by
//    Uber (needs_otp). So it NEVER touches that browser, its context, or the daemon / RAMEN
//    stream. It launches a SEPARATE, short-lived Chrome seeded from a COPY of the saved state
//    file (state/<companyKey>.json, read only), registers, exports, and closes.
//  * ALL of that browser's traffic goes through the company's OWN residential proxy (the
//    tenant's proxy_url, as the daemon uses it). A direct datacenter-IP hit on
//    account.uber.com looks like a new device/location, so a company with no proxy is skipped
//    ("no_proxy") before anything is read or launched.
//  * Idempotent: getPasskeysInfo first; any existing passkey => skip. The backend is asked
//    first too (it knows ours).
//  * Afterwards the LIVE session is re-checked with a normal keep-warm; anything but active =>
//    LOUD alert. By construction it should stay active.
//  * The exported private key goes to the backend (encrypted at rest there) and nowhere else:
//    it is never logged, written to disk or returned to the caller.
//
// Proven mechanism (spike/passkey-api): CDP virtual authenticator on an authenticated
// account.uber.com page -> getRegistrationOptions -> navigator.credentials.create() ->
// registerPublicKeyCredential with BASE64URL binaries (standard base64 is rejected).

import { readFile } from "node:fs/promises";
import { parseProxyUrl } from "./proxy.js";

export const PASSKEYS_URL = "https://account.uber.com/passkeys";
const AUTH_RE = /auth\.uber\.com|\/login|signin|loginEntry/i;

export const STATUS = {
  REGISTERED: "registered",
  DISABLED: "disabled",
  COMPANY_DISABLED: "company_disabled",
  NO_SESSION: "no_session",
  NO_PROXY: "no_proxy", // no residential proxy for the company: never register datacenter-direct
  BUSY: "busy",
  ALREADY_REGISTERED: "already_registered", // the backend already holds ours
  NOT_AUTHENTICATED: "not_authenticated", // account.uber.com did not accept this context
  FAILED: "failed",
  STORE_FAILED: "store_failed", // registered on Uber but the backend would not take the key
  SESSION_LOST: "session_lost", // the company needs a relink after the attempt
};

// Platform authenticator, discoverable credential, UV pre-satisfied, presence auto-simulated.
export const AUTHENTICATOR = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
  defaultBackupEligibility: true,
  defaultBackupState: true,
};

const STORE_RETRIES = 3;
const inFlight = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs IN the page: how many passkeys does the account already have? */
export async function probeInPage() {
  const H = { "content-type": "application/json", "x-csrf-token": "x", "x-uber-client-name": "uam_desktop", "x-uber-identity-entrypoint": "uam_desktop" };
  try {
    const info = await fetch("/api/getPasskeysInfo", { method: "POST", headers: H, body: "{}" }).then((r) => r.json());
    const list = info?.data?.publicKeyCredentials;
    return Array.isArray(list) ? { ok: true, count: list.length } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Runs IN the page: create + register one passkey, verify it grew. base64url ONLY. */
export async function registerInPage() {
  const H = { "content-type": "application/json", "x-csrf-token": "x", "x-uber-client-name": "uam_desktop", "x-uber-identity-entrypoint": "uam_desktop" };
  const fromUrl = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const toUrl = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const post = (path, body) => fetch(path, { method: "POST", headers: H, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text() }));
  const countNow = async () => {
    const info = await post("/api/getPasskeysInfo", {}).then((r) => JSON.parse(r.text)).catch(() => null);
    const list = info?.data?.publicKeyCredentials;
    return Array.isArray(list) ? list.length : null;
  };
  try {
    const ro = JSON.parse((await post("/api/getRegistrationOptions", {})).text);
    const o = ro?.data?.options;
    if (!o) return { step: "options" };
    const account = o.user.display_name || null;
    const alg = (p) => (p.alg && typeof p.alg === "object" ? p.alg.low : p.alg);
    const publicKey = {
      rp: o.rp,
      user: { id: fromUrl(o.user.id), name: account || "user", displayName: account || "user" },
      challenge: fromUrl(o.challenge),
      pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })),
      timeout: 60000,
      attestation: o.attestation || "none",
      authenticatorSelection: o.authenticatorSelection || { residentKey: "preferred", userVerification: "preferred" },
      excludeCredentials: [],
    };
    const c = await navigator.credentials.create({ publicKey });
    const transports = c.response.getTransports ? c.response.getTransports() : ["internal"];
    const res = await post("/api/registerPublicKeyCredential", {
      attestation: { client_data_json: toUrl(c.response.clientDataJSON), attestation_object: toUrl(c.response.attestationObject), transports },
    });
    const rejected = res.status !== 200 || !/"status":"success"/.test(res.text) || /recoverableError|BAD_REQUEST/i.test(res.text);
    if (rejected) return { step: "register_rejected", http: res.status };
    return { step: "done", account, count: await countNow() };
  } catch {
    return { step: "exception" };
  }
}

/** The fields the backend stores; anything else on the CDP credential is dropped. */
export function pickCredential(c, account = null) {
  return {
    credentialId: c.credentialId,
    privateKey: c.privateKey,
    rpId: c.rpId,
    userHandle: c.userHandle,
    signCount: c.signCount ?? 0,
    isResidentCredential: c.isResidentCredential !== false,
    ...(account ? { account } : {}),
  };
}

/** The saved state COPY for a company (read only, never written back); null when missing/unreadable. */
export async function readStateCopy(statePathFn, key) {
  try {
    return JSON.parse(await readFile(statePathFn(key), "utf8"));
  } catch {
    return null;
  }
}

/** Default launcher: the project's own Chrome + stealth context, seeded from the state copy, THROUGH the company proxy. */
async function launchIsolated({ state, proxyUrl, key }) {
  const { launchBrowser, newStealthContext } = await import("./browser.js");
  const browser = await launchBrowser();
  try {
    return { browser, context: await newStealthContext(browser, { storageState: state }, proxyUrl, key) };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/** Never throws; the credential travels only inside the returned object. Always closes its OWN browser. */
async function attempt({ state, proxyUrl, key, launch }, log) {
  let browser = null;
  try {
    const launched = await (launch ?? launchIsolated)({ state, proxyUrl, key });
    browser = launched.browser;
    return await registerOnContext(launched.context, log);
  } catch (e) {
    log(`attempt error: ${e?.message}`);
    return { status: STATUS.FAILED, reason: "error" };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function registerOnContext(context, log) {
  const page = await context.newPage();
  try {
    return await registerOnPage(context, page, log);
  } finally {
    await page.close?.()?.catch?.(() => {}); // a held (co-browse) context outlives this: leave no stray tab
  }
}

async function registerOnPage(context, page, log) {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
  await page.goto(PASSKEYS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  if (AUTH_RE.test(page.url())) return { status: STATUS.NOT_AUTHENTICATED };
  await page.waitForTimeout(2500);

  const before = await page.evaluate(probeInPage);
  if (!before?.ok) return { status: STATUS.FAILED, reason: "probe_failed" };

  const reg = await page.evaluate(registerInPage);
  if (reg?.step !== "done") return { status: STATUS.FAILED, reason: `register_${reg?.step ?? "unknown"}` };
  if (!(reg.count > before.count)) return { status: STATUS.FAILED, reason: "not_verified" };

  const { credentials } = await client.send("WebAuthn.getCredentials", { authenticatorId });
  if (!credentials?.length) return { status: STATUS.FAILED, reason: "no_credential" };
  log("credential exported");
  return { status: STATUS.REGISTERED, credential: pickCredential(credentials[credentials.length - 1], reg.account) };
}

async function storeWithRetry(backend, key, credential, orgUuid, backoffMs) {
  for (let i = 0; i < STORE_RETRIES; i++) {
    try {
      await backend.store(key, { credential, uber_org_uuid: orgUuid ?? undefined });
      return true;
    } catch {
      await sleep(backoffMs * (i + 1));
    }
  }
  return false;
}

/**
 * @param {string} companyKey
 * @param {object} deps
 * @param {() => boolean} deps.enabled        the uber-auth env flag
 * @param {object} deps.manager               PersistentSessionManager (stateOf, get, renew) - verified only, never parked/adopted/mutated
 * @param {(key:string)=>string} deps.statePath  path of the saved state file (a COPY is read)
 * @param {object} deps.backend               { status(key) -> {enabled, registered}, proxyUrl(key) -> string|null, store(key, body), fail(key, reason) }
 * @param {(m:string)=>void} [deps.log]
 * @param {(m:string)=>void} [deps.alert]     loud channel (console.error by default)
 * @returns {Promise<{status:string, reason?:string}>} never throws, never carries the credential
 */
export async function registerPasskey(companyKey, deps) {
  const { enabled, manager, backend, log = () => {}, alert = (m) => console.error(m), storeBackoffMs = 1500, attemptFn = attempt, statePath, launch } = deps;
  const key = String(companyKey);
  if (!enabled()) return { status: STATUS.DISABLED };
  if (manager.stateOf(key) !== "active") return { status: STATUS.NO_SESSION };
  if (inFlight.has(key)) return { status: STATUS.BUSY };
  inFlight.add(key);
  try {
    return await run(key, { manager, backend, log, alert, storeBackoffMs, attemptFn, statePath, launch });
  } catch (e) {
    alert(`[passkey][ALERT] ${key}: unexpected ${e?.message}`);
    return { status: STATUS.FAILED, reason: "error" };
  } finally {
    inFlight.delete(key);
  }
}

async function run(key, { manager, backend, log, alert, storeBackoffMs, attemptFn, statePath, launch }) {
  const flags = await backend.status(key).catch(() => null);
  if (!flags?.enabled) return { status: STATUS.COMPANY_DISABLED };
  if (flags.registered) return { status: STATUS.ALREADY_REGISTERED };

  // Proxy FIRST: without the company's residential proxy nothing is read or launched.
  const proxyUrl = await backend.proxyUrl(key).catch(() => null);
  if (!parseProxyUrl(proxyUrl)) return { status: STATUS.NO_PROXY };
  const state = await readStateCopy(statePath, key);
  if (!state) return { status: STATUS.NOT_AUTHENTICATED };

  const outcome = await attemptFn({ state, proxyUrl, key, launch }, log);

  let result = { status: outcome.status, reason: outcome.reason };
  if (outcome.status === STATUS.REGISTERED) {
    const stored = await storeWithRetry(backend, key, outcome.credential, manager.get(key)?.orgUuid, storeBackoffMs);
    if (stored) log(`${key}: passkey registered and stored`);
    else {
      alert(`[passkey][ALERT] ${key}: passkey exists on Uber but the backend did NOT store it - remove it on account.uber.com/passkeys`);
      await backend.fail(key, "store_failed").catch(() => {});
      result = { status: STATUS.STORE_FAILED };
    }
  } else if (outcome.status === STATUS.FAILED) {
    await backend.fail(key, outcome.reason ?? "failed").catch(() => {});
  }
  return (await sessionGuard(key, manager, backend, alert)) ?? result;
}

/**
 * Register from INSIDE the co-browse browser, after the human's login has LANDED and was adopted
 * (docs/31 Path A). That context is the session Uber keeps, so adding the passkey here is safe:
 * no separate browser, no second device, no daemon call. A short-lived extra TAB on the same
 * context does the work and is closed. Never throws; the credential stays inside this call.
 * @param {string} companyKey
 * @param {object} context  the adopted co-browse Playwright context
 * @param {object} deps     { enabled, manager, backend:{status,store,fail}, log?, alert?, storeBackoffMs? }
 */
export async function registerPasskeyInSession(companyKey, context, deps) {
  const { enabled, manager, backend, log = () => {}, alert = (m) => console.error(m), storeBackoffMs = 1500 } = deps;
  const key = String(companyKey);
  if (!enabled()) return { status: STATUS.DISABLED };
  if (manager.stateOf(key) !== "active") return { status: STATUS.NO_SESSION };
  if (inFlight.has(key)) return { status: STATUS.BUSY };
  inFlight.add(key);
  try {
    const flags = await backend.status(key).catch(() => null);
    if (!flags?.enabled) return { status: STATUS.COMPANY_DISABLED };
    if (flags.registered) return { status: STATUS.ALREADY_REGISTERED };
    const outcome = await registerOnContext(context, log);
    if (outcome.status === STATUS.FAILED) await backend.fail(key, outcome.reason ?? "failed").catch(() => {});
    if (outcome.status !== STATUS.REGISTERED) return { status: outcome.status, reason: outcome.reason };
    if (await storeWithRetry(backend, key, outcome.credential, manager.get(key)?.orgUuid, storeBackoffMs)) return { status: STATUS.REGISTERED };
    alert(`[passkey][ALERT] ${key}: passkey exists on Uber but the backend did NOT store it - remove it on account.uber.com/passkeys`);
    await backend.fail(key, "store_failed").catch(() => {});
    return { status: STATUS.STORE_FAILED };
  } catch (e) {
    alert(`[passkey][ALERT] ${key}: unexpected ${e?.message}`);
    return { status: STATUS.FAILED, reason: "error" };
  } finally {
    inFlight.delete(key);
  }
}

/** The live session is never touched, so it must still be active; one normal keep-warm proves it. */
async function sessionGuard(key, manager, backend, alert) {
  await manager.renew(key);
  if (manager.stateOf(key) === "active") return null;
  alert(`[passkey][ALERT] ${key}: session is ${manager.stateOf(key)} after a passkey attempt - needs a relink (the isolated browser never touched it: investigate)`);
  await backend.fail(key, "session_lost").catch(() => {});
  return { status: STATUS.SESSION_LOST };
}
