// Server-side software-passkey REGISTRATION (dormant: persistent.js gates every call behind
// UBER_AUTH_PASSKEY_REGISTER and the backend's own enabled flag). An ISOLATED short-lived
// context - never a held production one - loads the company's existing session cookies,
// attaches a CDP virtual authenticator and lets Uber's own "Create a passkey" flow register it.
// The exported private key is a high-value secret: this module never logs it, only a `reason`.

import { launchBrowser, newStealthContext } from "./browser.js";
import { scopeCookies } from "./cookieScope.js";

export const PASSKEYS_URL = "https://account.uber.com/passkeys";
export const REASON = {
  LOGGED_OUT: "logged_out",
  BUTTON_NOT_FOUND: "button_not_found",
  NO_CREDENTIAL: "no_credential",
  TIMEOUT: "timeout",
  CAPACITY: "capacity",
  ERROR: "error",
};

const OVERALL_TIMEOUT_MS = 75_000;
const CREDENTIAL_TIMEOUT_MS = 20_000;
const LOGGED_OUT_RE = /auth\.uber\.com|\/login|signin|loginEntry/i;
// de + en: "Create a passkey" / "Passkey erstellen" / "Passkey hinzufügen" ...
const CREATE_RE = /create (a )?passkey|add (a )?passkey|passkey (erstellen|hinzufügen|anlegen|einrichten)/i;
const CONFIRM_RE = /^(create|continue|confirm|erstellen|weiter|fortfahren|bestätigen)\b|create (a )?passkey|passkey (erstellen|hinzufügen)/i;

// Platform authenticator, discoverable credential, UV pre-satisfied, presence auto-simulated.
export const AUTHENTICATOR = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
};

const inFlight = new Set();
let running = false; // global cap of 1: a Chromium per registration is costly

class StepError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const fail = (reason) => ({ ok: false, reason });

/** The fields the backend stores; anything else on the CDP credential is dropped. */
export function pickCredential(c) {
  return {
    credentialId: c.credentialId,
    privateKey: c.privateKey,
    rpId: c.rpId,
    userHandle: c.userHandle,
    signCount: c.signCount ?? 0,
    isResidentCredential: c.isResidentCredential !== false,
  };
}

function waitFor(client, event, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    client.once(event, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function clickCreate(page) {
  try {
    await page.getByRole("button", { name: CREATE_RE }).first().click({ timeout: 15_000 });
  } catch {
    throw new StepError(REASON.BUTTON_NOT_FOUND);
  }
  // Optional confirm step in a modal; absent on some layouts.
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: CONFIRM_RE }).last().click({ timeout: 6_000 }).catch(() => {});
}

async function readNewCredential(client, authenticatorId, added) {
  const { credentials } = await client.send("WebAuthn.getCredentials", { authenticatorId });
  if (!credentials?.length) throw new StepError(added ? REASON.NO_CREDENTIAL : REASON.TIMEOUT);
  return pickCredential(credentials[credentials.length - 1]);
}

async function runFlow(page, client, credentialMs) {
  await client.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
  await page.goto(PASSKEYS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  if (LOGGED_OUT_RE.test(page.url())) throw new StepError(REASON.LOGGED_OUT);
  const addedP = waitFor(client, "WebAuthn.credentialAdded", credentialMs);
  await clickCreate(page);
  return readNewCredential(client, authenticatorId, await addedP);
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StepError(REASON.TIMEOUT)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function closeQuietly(obj) {
  await obj?.close?.().catch(() => {});
}

/**
 * Register one software passkey on the company's Uber account. Resolves
 * { ok:true, credential } or { ok:false, reason }; NEVER throws.
 */
export async function registerPasskey(companyKey, { cookies, supplierCookies, proxyUrl = null } = {}, deps = {}) {
  const { launch = launchBrowser, newContext = newStealthContext, overallMs = OVERALL_TIMEOUT_MS, credentialMs = CREDENTIAL_TIMEOUT_MS } = deps;
  const key = String(companyKey);
  if (inFlight.has(key) || running) return fail(REASON.CAPACITY);
  inFlight.add(key);
  running = true;
  const held = { browser: null, context: null, done: false };
  try {
    const flow = (async () => {
      held.browser = await launch();
      if (held.done) {
        await closeQuietly(held.browser); // deadline hit while launching: finally already ran
        throw new StepError(REASON.TIMEOUT);
      }
      held.context = await newContext(held.browser, {}, proxyUrl, key);
      await held.context.addCookies(scopeCookies(cookies, supplierCookies));
      const page = await held.context.newPage();
      const client = await held.context.newCDPSession(page);
      return runFlow(page, client, credentialMs);
    })();
    flow.catch(() => {}); // a late rejection after the deadline must not go unhandled
    return { ok: true, credential: await withDeadline(flow, overallMs) };
  } catch (e) {
    return fail(e instanceof StepError ? e.reason : REASON.ERROR);
  } finally {
    held.done = true;
    await closeQuietly(held.context);
    await closeQuietly(held.browser);
    inFlight.delete(key);
    running = false;
  }
}
