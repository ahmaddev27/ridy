// Drives a real Chromium through Uber's fleet sign-in. Because Uber splits the
// flow across email -> password -> optional MFA and blocks headless automation
// with a code, the browser is held open between HTTP calls so a human can relay
// the MFA code. Nothing here decides business logic — it returns a status and,
// on success, the captured cookies + org uuid.

import { chromium } from "playwright";
import { config } from "./config.js";
import { parseProxyUrl } from "./proxy.js";
import { tenantScreen } from "./fingerprint.js";

// Browsers launched as REAL Chrome (headed under Xvfb): they emit their own genuine UA.
const realChrome = new WeakSet();

export const STATUS = {
  SUCCESS: "success",
  MFA_REQUIRED: "mfa_required",
  PASSKEY_UNSUPPORTED: "passkey_unsupported",
  BAD_CREDENTIALS: "bad_credentials",
  CAPTURE_FAILED: "capture_failed", // Uber let us in but the backend did not accept the capture
  BLOCKED: "blocked", // Uber's Arkose challenge: never solved, the manager is sent to the extension
  PASSWORD_REQUIRED: "password_required", // Uber asked for a password and we hold none
  CHANNEL_UNAVAILABLE: "channel_unavailable", // no code step reached (e.g. a chooser with no default)
  NO_SESSION: "no_session", // a passwordless start with nothing to ride and no cold clearance
  NO_PROXY: "no_proxy", // a cold login needs the company's residential proxy
  CHALLENGE_REQUIRED: "challenge_required", // Arkose shown and co-browse is on: the browser stays open for a human
  WRONG_CODE: "wrong_code", // every code channel tried, none accepted
  ERROR: "error",
};

function passwordField(page) {
  return page.locator('input[type="password"]').first();
}

function otpField(page) {
  return page
    .locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]')
    .first();
}

function identifierField(page) {
  return page
    .getByPlaceholder(/phone number or email|telefonnummer oder e-mail/i)
    .or(page.locator('input[type="email"], input[type="tel"], input[name="identifier" i]'))
    .first();
}

function continueButton(page) {
  return page
    .getByRole("button", {
      // \bweiter\b matches the "Weiter" submit button but NOT "Weitere Optionen" (More options):
      // on the OTP screen advance() was clicking "Weitere Optionen" (it starts with "Weiter"),
      // navigating away instead of submitting the code, so a correct code read as wrong.
      name: /continue|next|further|\bweiter\b|sign in|log ?in|anmelden|verify|bestätigen|absenden|submit/i,
    })
    .first();
}

/** Click the primary action, falling back to Enter (Uber often accepts either). */
async function advance(page, trace = null) {
  const btn = continueButton(page);
  if (await isVisible(btn)) {
    if (trace) {
      const name = ((await btn.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 40);
      console.log(`[pwless-nav] advance(${trace}) clicking button "${name}"`);
    }
    await btn.click().catch(() => page.keyboard.press("Enter"));
  } else {
    if (trace) console.log(`[pwless-nav] advance(${trace}) no button visible; pressing Enter`);
    await page.keyboard.press("Enter");
  }
}

/**
 * Enter the identifier the way a person would. Uber's v2 sign-in form is a React controlled
 * input: a programmatic value (`fill`) sets the DOM value but not React's state, so clicking
 * "Weiter" submits an empty identifier and the page never leaves the screen. Real per-character
 * keystrokes update React's state; we then submit, and fall back to Enter if the click is
 * swallowed. `[pwless-nav]` lines let this be tuned from the log.
 */
async function submitIdentifier(page, idField, email) {
  await idField.click().catch(() => {});
  await idField.fill("").catch(() => {}); // clear any partial / autofilled value
  await idField.pressSequentially(email, { delay: 40 });
  await page.waitForTimeout(400); // let the SPA validate and enable the submit
  navLog(`identifier typed=${((await idField.inputValue().catch(() => "")) || "").length > 0 ? "yes" : "EMPTY"}`);
  await advance(page, "identifier");
  await page.waitForTimeout(800);
  if (await isVisible(idField)) {
    navLog("identifier still visible after click; pressing Enter");
    await idField.press("Enter").catch(() => {});
  }
  navLog(`after identifier submit: url=${(page.url() || "").replace(/[?#].*$/, "")}`);
}

/**
 * Type an OTP into whatever shape Uber renders — a single field or a row of
 * one-char boxes. Focusing the first box and typing lets the boxes auto-advance.
 */
async function typeOtp(page, code) {
  const boxes = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[maxlength="1"]');
  const count = await boxes.count().catch(() => 0);
  navLog(`typeOtp: ${count} box(es), code length ${code.length}`);

  if (count > 1) {
    await boxes.first().click();
    await page.keyboard.type(code, { delay: 80 });
    return;
  }
  await otpField(page).fill(code);
}

/** Launch options that make an automated Chrome look like a normal one. */
export async function launchBrowser() {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    // In a container Chromium's sandbox usually can't start; the container is the
    // isolation boundary. Off by default (NO_SANDBOX unset) for desktop safety.
    ...(config.noSandbox ? ["--no-sandbox"] : []),
  ];
  const real = await launchRealChrome(args);
  if (real) return real;
  // Prefer the real installed Chrome — far less likely to be flagged than the
  // bundled Chromium. Fall back to Chromium if Chrome is not present.
  try {
    return await chromium.launch({ headless: !config.headful, channel: "chrome", args });
  } catch {
    return await chromium.launch({ headless: !config.headful, args });
  }
}

/**
 * REAL_CHROME=1 pilot: genuine Chrome, HEADED under Xvfb (needs DISPLAY), so there is
 * no HeadlessChrome / Linux-SwiftShader tell. Returns null on any shortfall (flag off,
 * no display, Chrome missing) so the caller falls back to the bundled headless Chromium.
 */
async function launchRealChrome(args) {
  if (!config.realChrome || !process.env.DISPLAY) return null;
  try {
    const browser = await chromium.launch({ headless: false, channel: "chrome", args });
    realChrome.add(browser);
    return browser;
  } catch (e) {
    console.warn(`[browser] real Chrome unavailable, using bundled Chromium: ${e?.message}`);
    return null;
  }
}

export async function newStealthContext(browser, extra = {}, proxyUrl = null, tenantKey = null) {
  // The company's residential proxy (same one the daemon uses); none -> direct, as before.
  const proxy = parseProxyUrl(proxyUrl);
  const options = {
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    // Extra context options (e.g. { storageState } when resuming a saved session).
    ...(proxy ? { proxy } : {}),
    ...extra,
  };
  if (realChrome.has(browser)) {
    // Let Chrome emit its own UA + matching sec-ch-ua; an override is what mismatches them.
    delete options.userAgent;
    if (tenantKey != null && !extra.viewport) Object.assign(options, tenantScreen(tenantKey));
  }
  const context = await browser.newContext(options);
  // Hide the two most-checked automation tells.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["de-DE", "de", "en"] });
  });
  return context;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does the page text show this email, in full or masked (j***@example.com)? A mask must
 * keep the first character and the whole domain, so a different account never matches.
 */
export function accountMatches(pageText, email) {
  const text = String(pageText ?? "").toLowerCase();
  const wanted = String(email ?? "").trim().toLowerCase();
  const at = wanted.indexOf("@");
  if (!text || at < 1) return false;
  if (text.includes(wanted)) return true;
  const mask = new RegExp(`${escapeRe(wanted[0])}[*•·●.x\\u2022\\u25cf]{1,}[^\\s@]{0,20}@${escapeRe(wanted.slice(at + 1))}`);
  return mask.test(text);
}

async function pageShowsAccount(page, email) {
  try {
    return accountMatches(await page.locator("body").innerText({ timeout: 3000 }), email);
  } catch {
    return false;
  }
}

async function isVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function hasPasskeyPrompt(page) {
  try {
    return await page
      .getByText(/passkey|security key|use your (phone|device)|windows hello/i)
      .first()
      .isVisible();
  } catch {
    return false;
  }
}

/**
 * Uber's Arkose bot challenge ("Protecting your account" / "Start Puzzle"). We never
 * solve or bypass it: seeing it ends the attempt and the manager is sent to the
 * extension, where a human is present.
 */
async function hasArkoseChallenge(page) {
  try {
    const text = page
      .getByText(
        /protecting your account|start puzzle|verify (you are|you'?re) (a )?human|konto (wird )?gesch(ü|u)tzt|schutz (ihres|deines) kontos|r(ä|a)tsel starten|echter mensch/i,
      )
      .first();
    if (await text.isVisible()) return true;
    // A preloaded but hidden Arkose frame is not a challenge: it must be visible and real-sized.
    const frame = page.locator('iframe[src*="arkoselabs" i], iframe[src*="funcaptcha" i], [id*="arkose" i]').first();
    if (!(await frame.isVisible())) return false;
    const box = await frame.boundingBox();
    return box != null && box.width >= 100 && box.height >= 100;
  } catch {
    return false;
  }
}

/**
 * Uber's "Welcome back" / verification-method chooser: it recognised the account (by email) and
 * offers how to verify ("Weitere Optionen" -> "Wähle eine andere Bestätigungsmethode" -> E-Mail).
 * The passwordless flow navigates it to the email code. Checked only when no code field is up yet,
 * so it never shadows the actual `otp` step.
 */
async function hasChannelChoice(page) {
  try {
    return await page
      // Only the method-chooser HEADING, never the bare "Weitere Optionen"/"More options" button:
      // that button also sits on the OTP and identifier screens, so matching it mis-read the OTP
      // screen as `channel_choice` right after the code was submitted.
      .getByText(
        /willkommen zur(ü|u)ck|welcome back|w(ä|a)hle eine andere|andere bestätigungs?methode|w(ä|a)hle eine (verifizierungs|bestätigungs)|another (verification )?method|choose (a|another) (verification )?method/i,
      )
      .first()
      .isVisible();
  } catch {
    return false;
  }
}

/**
 * Poll the page until one of the known steps is reached or the budget runs out.
 * @returns {'landed'|'password'|'otp'|'passkey'|'channel_choice'|'arkose'|'unknown'}
 */
export async function detectStep(page) {
  const deadline = Date.now() + config.stepTimeout;
  while (Date.now() < deadline) {
    const step = await probeStep(page);
    if (step) return step;
    await page.waitForTimeout(500);
  }
  // Uber's risk-check interstitial ("Schutz Ihres Kontos" / "Rätsel starten") can render only
  // after the step budget, once the identifier submit has been scored. Give it a brief last
  // chance so a late Arkose is reported as `arkose` (-> backend `blocked`), not `unknown`.
  const arkoseDeadline = Date.now() + 8000;
  while (Date.now() < arkoseDeadline) {
    if (await hasArkoseChallenge(page)) return "arkose";
    await page.waitForTimeout(500);
  }
  await dumpScreen(page, "detectStep-unknown");
  return "unknown";
}

/** One non-blocking look at the page: the step it shows, or null when nothing is recognised yet. */
export async function probeStep(page) {
  if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) return "landed";
  if (await hasArkoseChallenge(page)) return "arkose";
  if (await isVisible(otpField(page))) return "otp";
  if (await isVisible(passwordField(page))) return "password";
  // The method chooser ("Willkommen zurück" / "Wähle eine andere …") BEFORE passkey: it offers a
  // Passkey button among the code methods, which must NOT be read as a passkey-only prompt (that
  // sent the flow down the passkey path and picked the wrong channel instead of email-first).
  if (await hasChannelChoice(page)) return "channel_choice";
  if (await hasPasskeyPrompt(page)) return "passkey";
  return null;
}

// --- Co-browse: a human solves Arkose in THIS browser (docs/28) ---------------------------
export const CHALLENGE_MAX_RETRIES = 3;

// The authenticated surface a human-driven full login must actually reach (the dispatch panel we
// navigated to). In full mode the manager roams real Uber pages, and probeStep reads ANY non-auth
// URL as "landed" — so a stray click to uber.com/help, or a transient redirect host, would end the
// stream and capture an unauthenticated browser. A real landing is on THIS host, and stable.
const DASHBOARD_HOST = (() => {
  try {
    return new URL(config.dashboardUrl).hostname.toLowerCase();
  } catch {
    return "vsdispatch.uber.com";
  }
})();
// The known authenticated fleet surfaces: you cannot be on any of them unauthenticated (Uber
// redirects to the sign-in host), so reaching one is a real landing — unlike www./help.uber.com.
const DASHBOARD_HOSTS = /(^|\.)(vsdispatch|supplier|fleethub)\.uber\.com$/i;
const onDashboard = (page) => {
  try {
    const host = new URL(page.url()).hostname.toLowerCase();
    return host === DASHBOARD_HOST || DASHBOARD_HOSTS.test(host);
  } catch {
    return false;
  }
};
const TRY_AGAIN_RE = /try again|erneut versuchen|versuchen sie es erneut|noch einmal versuchen/i;

/** "Try again" can render inside the cross-origin Arkose frame, so every frame is searched. */
async function showsTryAgain(page) {
  const frames = page.frames?.() ?? [page];
  for (const f of frames) if (await isVisible(f.getByText(TRY_AGAIN_RE).first())) return true;
  return false;
}

/**
 * One tick of a login parked on the Arkose puzzle (shared by the stream watcher and /login/resume).
 * @returns {Promise<'challenge'|'failed'|'landed'|'otp'|'password'|'passkey'>}
 *   'challenge' = still on the puzzle (or between rounds); 'failed' = Arkose re-rendered it
 *   CHALLENGE_MAX_RETRIES times; anything else = the step we reached after leaving the challenge.
 */
export async function challengeTick(session) {
  const state = (session.challenge ??= { retries: 0, retrying: false });
  const step = await probeStep(session.page);
  if (step && step !== "arkose") {
    // Arkose mode: any step off the puzzle is terminal (the next phase takes over). Full mode: the
    // manager drives every page, so only a STABLE landing on the dispatch dashboard is a real
    // success; an otp/password/passkey step, or a stray non-dashboard page, means keep streaming.
    if (!session.fullLogin) return step;
    if (step === "landed" && onDashboard(session.page)) {
      session.landedTicks = (session.landedTicks ?? 0) + 1;
      return session.landedTicks >= 2 ? "landed" : "challenge";
    }
    session.landedTicks = 0;
    return "challenge";
  }
  if (session.fullLogin) session.landedTicks = 0;
  const retrying = await showsTryAgain(session.page);
  if (retrying && !state.retrying) state.retries++;
  state.retrying = retrying;
  return state.retries >= CHALLENGE_MAX_RETRIES ? "failed" : "challenge";
}

/**
 * The puzzle was left for `step`: continue exactly as startLogin would have. The stream is already
 * closed by now, so the code step is reached with nothing watching it.
 */
export async function finishChallenge(session, step) {
  const { context, page } = session;
  try {
    if (step === "passkey" || step === "channel_choice") step = await navigatePastPasskey(page);
    if (step === "landed") return { status: STATUS.SUCCESS, result: await captureResult(context, page), session };
    if (step === "otp") return { status: STATUS.MFA_REQUIRED, session };
    if (step === "arkose") return { status: STATUS.CHALLENGE_REQUIRED, session };
    await closeSession(session);
    if (step === "passkey") return { status: STATUS.PASSKEY_UNSUPPORTED };
    return { status: step === "password" ? STATUS.PASSWORD_REQUIRED : STATUS.CHANNEL_UNAVAILABLE };
  } catch (e) {
    await closeSession(session).catch(() => {});
    return { status: STATUS.ERROR, message: e.message };
  }
}

// --- Passwordless: passkey -> code navigation -------------------------------------------
// Uber offers a passkey first when the account has one, yet the SAME account can still get a
// code through "try another way". All selectors are TEXT based (case-insensitive) and live here
// so they are easy to tune from the `[pwless-nav]` log lines. Sign-in UI only: no Uber write.
export const NAV_MAX_HOPS = 4; // channel attempts per navigation (sms, whatsapp, email, call)
const NAV_CLICK_WAIT_MS = 1200; // how long a control may take to appear
const NAV_SETTLE_MS = 1200; // how long a menu-opening click may take to land on a step
const NAV_CODE_WAIT_MS = 6000; // a channel click sends a code: allow Uber time to render the boxes (polls fast, returns early)
const SUBMIT_SETTLE_MS = 8000; // after typing a code (replaces the ~38s detectStep): landed/chooser/arkose exit at once; only a genuine same-channel wrong code waits this out
const POLL_MS = 200;
const NAV_CLICKABLE = 'button, a, [role="button"], [role="link"], [role="option"], [role="radio"], [role="menuitem"], li, label';

// "Open the method list" controls. Tuned from the live German UI ("Weitere Optionen" ->
// "Wähle eine andere Bestätigungsmethode"). Deliberately NOT a bare `code`: that matched the
// SMS button ("Code per Textnachricht versenden") and would have sent the code to a phone.
export const ANOTHER_WAY_RE =
  /try another way|another way|more options|other options|weitere optionen|alle optionen( anzeigen)?|use another method|sign in another way|verify another way|use a code|sign in with a code|w(ä|a)hle eine andere|andere (option|bestätigungs?methode)|anders anmelden|stattdessen/i;
// Email only: a bare "code senden" also matched the SMS item ("SMS mit Anmeldecode senden").
export const EMAIL_OPTION_RE = /e-?mail/i;

// Code channels in the order we try them: EMAIL first (the manager has the mailbox, and the auto
// email-forward needs it); SMS / WhatsApp / call are automatic fallbacks when a code is rejected.
// Google / passkey / social buttons are NEVER code channels (OAuth is not a code).
export const CHANNELS = [
  { name: "email", re: EMAIL_OPTION_RE },
  { name: "sms", re: /sms|text message|textnachricht|anmeldecode.*senden/i },
  { name: "whatsapp", re: /whatsapp/i },
  { name: "call", re: /anruf|phone call|call me|voice/i },
];
export const NEVER_CLICK_RE = /google|passkey|apple|facebook|sicherheitsschl/i;

const navLog = (m) => console.log(`[pwless-nav] ${m}`);

/**
 * Failure-path diagnostic: log the current screen's chrome (url, title, headings, control
 * labels) so the text selectors above can be tuned from the log instead of guessed. Fires only
 * when a step is not recognised. Never logs PII: emails and any run of digits are redacted.
 */
async function dumpScreen(page, where, session = null) {
  // A human-driven login may be mid-typing an email/OTP: no text trace, no screenshot (docs/28 §11.3).
  if (session?.fullLogin) return;
  const redact = (s) =>
    (s || "").replace(/\s+/g, " ").trim().replace(/[\w.+-]+@[\w.-]+\.\w+/g, "<email>").replace(/\b\d{3,}\b/g, "<num>");
  const uniq = (list) => [...new Set(list.map(redact).filter(Boolean))].slice(0, 25);
  try {
    const url = (page.url() || "").replace(/[?#].*$/, "");
    const title = redact(await page.title().catch(() => ""));
    const headings = uniq(await page.locator("h1, h2, [role=heading]").allInnerTexts().catch(() => []));
    const controls = uniq(await page.locator(NAV_CLICKABLE).allInnerTexts().catch(() => []));
    const alerts = uniq(await page.locator('[role=alert], [aria-live], .error, [class*="error" i], [data-baseweb="form-control-error"]').allInnerTexts().catch(() => []));
    const body = redact(await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")).slice(0, 500);
    const btnDisabled = await page.getByRole("button", { name: /^weiter$|continue|next/i }).first().isDisabled().catch(() => null);
    navLog(`screen @ ${where} url=${url} title=${JSON.stringify(title)} headings=${JSON.stringify(headings)} controls=${JSON.stringify(controls)}`);
    navLog(`screen+ @ ${where} submitDisabled=${btnDisabled} alerts=${JSON.stringify(alerts)} body=${JSON.stringify(body)}`);
    // The screenshot is the one thing that writes to disk; keep it behind PWLESS_DEBUG so
    // production never leaves a login-page image in /tmp. The redacted text lines above are enough
    // to diagnose a selector miss; set PWLESS_DEBUG=1 for the live selector-tuning loop.
    if (process.env.PWLESS_DEBUG === "1") {
      const shot = `/tmp/pwless-${where.replace(/[^a-z0-9]+/gi, "-")}.png`;
      await page.screenshot({ path: shot, fullPage: false }).then(() => navLog(`screenshot=${shot}`)).catch((e) => navLog(`screenshot failed: ${e.message}`));
    }
  } catch (e) {
    navLog(`dumpScreen failed @ ${where}: ${e.message}`);
  }
}

/**
 * Shortest-text visible+enabled clickable matching `re` (the leaf control, not a container
 * that happens to hold several options). Controls naming Google/passkey are never returned.
 * Polls fast for `waitMs`; waitMs 0 = a single look. Never logs PII.
 */
async function findControl(page, re, waitMs = NAV_CLICK_WAIT_MS) {
  const deadline = Date.now() + waitMs;
  do {
    try {
      let best = null;
      for (const el of await page.locator(NAV_CLICKABLE).filter({ hasText: re }).all()) {
        if (!(await isVisible(el)) || !(await el.isEnabled().catch(() => false))) continue;
        const text = ((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (NEVER_CLICK_RE.test(text)) continue;
        if (!best || text.length < best.text.length) best = { el, text };
      }
      if (best) return best;
    } catch {
      /* page mid-navigation: retry until the deadline */
    }
    if (Date.now() < deadline) await page.waitForTimeout(POLL_MS);
  } while (Date.now() < deadline);
  return null;
}

/** Click the control; returns the (truncated) matched label, or null when none is clickable. */
export async function clickControl(page, re, waitMs = NAV_CLICK_WAIT_MS) {
  const found = await findControl(page, re, waitMs);
  if (!found) return null;
  await found.el.click({ timeout: 3000 }).catch(() => {});
  return found.text || "(no text)";
}

/** Poll briefly after a click for a decisive step; null = still on a passkey/chooser/unknown screen. */
async function settleStep(page, ms = NAV_SETTLE_MS) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) return "landed";
    if (await hasArkoseChallenge(page)) return "arkose";
    if (await isVisible(otpField(page))) return "otp";
    await page.waitForTimeout(POLL_MS);
  }
  return null;
}

/**
 * Click the first UNTRIED code channel (CHANNELS order). If none is visible, open the
 * "more options" menu once and look again at once (no settle wait for a menu).
 * Returns the channel name or null. `ops.click(page, re, waitMs)` is injectable.
 */
export async function selectChannel(page, tried, ops = {}) {
  const click = ops.click ?? clickControl;
  // Reveal the full method list FIRST ("Weitere Optionen"/"Alle Optionen"), so a higher-priority
  // channel like email — often hidden behind that expander on the "Welcome back" screen — is not
  // skipped for a visible lower one (whatsapp/sms). No-op when there is nothing to expand.
  await click(page, ANOTHER_WAY_RE, 0);
  for (const ch of CHANNELS) {
    if (tried.has(ch.name)) continue;
    if (await click(page, ch.re, NAV_CLICK_WAIT_MS)) return ch.name;
  }
  return null;
}

/**
 * From a method chooser, send a code via the next untried channel and wait for the code
 * step. Adds every attempted channel to `tried`. Returns {step, channel}; step is
 * 'otp'|'landed'|'arkose' or 'passkey' when no channel is left / none reached the code step.
 */
export async function reachCodeStep(page, tried, ops = {}) {
  const settle = ops.settle ?? settleStep;
  for (let hop = 1; hop <= NAV_MAX_HOPS; hop++) {
    const channel = await selectChannel(page, tried, ops);
    if (!channel) {
      navLog(`hop ${hop}: no untried code channel found (tried=${[...tried].join(",") || "-"})`);
      return { step: "passkey", channel: null };
    }
    tried.add(channel);
    const step = await settle(page, NAV_CODE_WAIT_MS);
    navLog(`hop ${hop}: channel=${channel}; step after=${step ?? "none"}`);
    if (step) return { step, channel };
  }
  return { step: "passkey", channel: null };
}

/** Passkey/chooser start: reach the code step. Returns {step, channel}. */
export async function navigatePastPasskey(page, ops = {}) {
  navLog("step=passkey; trying to reach the code step");
  return reachCodeStep(page, ops.tried ?? new Set(), ops);
}

/** A rejected code lands on the chooser: its heading, or a code-channel button, with no code boxes. */
async function showsChannelOptions(page) {
  if (await isVisible(otpField(page))) return false;
  if (await hasChannelChoice(page)) return true;
  for (const ch of CHANNELS) if (await findControl(page, ch.re, 0)) return true;
  return false;
}

/** After submitting a code: 'landed'|'arkose'|'chooser' (code rejected)|'otp' (still on boxes)|null. */
async function settleAfterSubmit(page, ms = SUBMIT_SETTLE_MS) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) return "landed";
    if (await hasArkoseChallenge(page)) return "arkose";
    if (await showsChannelOptions(page)) return "chooser";
    await page.waitForTimeout(POLL_MS);
  }
  return (await isVisible(otpField(page))) ? "otp" : null;
}

/** The logged-in fleet account's uuid (= partnerUUID / org). */
async function captureOrgUuid(page) {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const m =
      html.match(/CustomerGatewayUser:([0-9a-f-]{36})/i) ||
      html.match(/"uuid":"([0-9a-f-]{36})"/i);
    return m ? m[1] : null;
  });
}

async function captureResult(context, page) {
  const cookies = await context.cookies();
  const expiries = cookies.map((c) => c.expires).filter((e) => typeof e === "number" && e > 0);
  const expiresAt = expiries.length ? new Date(Math.min(...expiries) * 1000).toISOString() : null;
  const orgUuid = await captureOrgUuid(page).catch(() => null);

  return {
    cookies: cookies.map((c) => ({ name: c.name, value: c.value })),
    org_uuid: orgUuid,
    expires_at: expiresAt,
  };
}

/**
 * `cobrowse` = the server already verified the co-browse preconditions (docs/28 §6). Only then
 * does an Arkose challenge return `challenge_required` (session kept open) instead of `blocked`.
 *
 * Begin a login. On MFA the returned session keeps the browser open for
 * submitMfa(); otherwise it is closed before returning.
 *
 * Passwordless (no `password`): after the email Uber sends a code on its DEFAULT
 * channel and shows the code boxes; we never navigate a channel chooser. A
 * password step with no password to give, or a step we cannot recognise, ends
 * the attempt (password_required / channel_unavailable) rather than guessing.
 * `proxyUrl` is the company's residential proxy (the one the daemon uses).
 *
 * `cold` = first connect with no prior session: a fresh browser through the company's proxy
 * (real Chrome when REAL_CHROME), the same email -> code steps. Arkose still ends it as `blocked`.
 *
 * `reuse` = the company's persistent browser handle ({browser, context, page}): the
 * WARM re-authentication path. It rides the browser that already holds the company's
 * cookies and proxy (Uber shows "Welcome back", far less Arkose risk than a cold
 * login), and is never closed on failure — only its page state is abandoned.
 */
export async function startLogin({ email, password = null, proxyUrl = null, companyKey = null, reuse = null, cold = false, cobrowse = false, full = false }) {
  // A passwordless login with nothing to ride and no explicit cold clearance never builds a
  // browser: a stray fresh session must be unreachable (server.js admits cold only for an empty slot).
  if (!password && !reuse && !cold) return { status: STATUS.NO_SESSION, message: "no_session" };
  if (cold && !parseProxyUrl(proxyUrl)) return { status: STATUS.NO_PROXY, message: "no_proxy" };
  const session = reuse ? Object.assign(reuse, { reused: true }) : await freshSession(proxyUrl, companyKey);
  const { context, page } = session;
  page.setDefaultTimeout(config.stepTimeout);

  try {
    await page.goto(config.dashboardUrl, { waitUntil: "domcontentloaded" });

    // Already authenticated (stored cookies). Keep the browser open so the
    // persistent manager can adopt it; the caller closes it if it won't.
    if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) {
      const result = await captureResult(context, page);
      return { status: STATUS.SUCCESS, result, session };
    }

    // fullLogin (docs/28 §11): the manager drives the WHOLE login in the stream, so nothing is
    // typed or clicked here. Park on the auth page; the server only admits this for a cold start.
    if (full && cobrowse) {
      session.fullLogin = true;
      return { status: STATUS.CHALLENGE_REQUIRED, session };
    }

    // A remembered account ("Welcome back") may not ask for the identifier again. Then we
    // only continue if the page shows the SAME account (its email or a masked form of it);
    // otherwise Continue would send a code to / sign in a different remembered account.
    const idField = identifierField(page);
    if (await idField.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false)) {
      await submitIdentifier(page, idField, email);
    } else if (!(await pageShowsAccount(page, email))) {
      await dumpScreen(page, "account_not_shown");
      await closeSession(session);
      return { status: STATUS.CHANNEL_UNAVAILABLE, message: "account_not_shown" };
    } else {
      await advance(page, "identifier");
    }

    let step = await detectStep(page);

    if (step === "password") {
      if (!password) {
        await closeSession(session);
        return { status: STATUS.PASSWORD_REQUIRED };
      }
      await passwordField(page).fill(password);
      await advance(page);
      step = await detectStep(page);
    }

    if (step === "landed") {
      const result = await captureResult(context, page);
      // Leave the browser open for the persistent manager to adopt.
      return { status: STATUS.SUCCESS, result, session };
    }
    if (step === "otp") {
      session.channelsTried = new Set(); // Uber's default channel is unknown to us
      session.channel = "unknown";
      return { status: STATUS.MFA_REQUIRED, session, channel: "unknown" };
    }
    if ((step === "channel_choice" || step === "passkey") && !password) {
      const reached = await navigatePastPasskey(page, { tried: (session.channelsTried = new Set()) });
      step = reached.step;
      if (step === "landed") return { status: STATUS.SUCCESS, result: await captureResult(context, page), session };
      if (step === "otp") {
        session.channel = reached.channel;
        return { status: STATUS.MFA_REQUIRED, session, channel: reached.channel };
      }
      // If choosing a method itself triggers Arkose, fall through to the arkose handler below,
      // which keeps the browser open for co-browse when enabled (instead of closing to `blocked`).
    }
    if (step === "passkey") {
      await closeSession(session);
      return { status: STATUS.PASSKEY_UNSUPPORTED };
    }
    if (step === "arkose") {
      // Co-browse (docs/28): keep the browser open so the manager can solve the puzzle themselves.
      if (cobrowse) return { status: STATUS.CHALLENGE_REQUIRED, session };
      await closeSession(session);
      return { status: STATUS.BLOCKED, message: "arkose" };
    }

    await closeSession(session);
    return { status: password ? STATUS.BAD_CREDENTIALS : STATUS.CHANNEL_UNAVAILABLE };
  } catch (e) {
    await closeSession(session).catch(() => {});
    return { status: STATUS.ERROR, message: e.message };
  }
}

async function freshSession(proxyUrl, companyKey) {
  const browser = await launchBrowser();
  const context = await newStealthContext(browser, {}, proxyUrl, companyKey);
  const page = await context.newPage();
  return { browser, context, page, createdAt: Date.now() };
}

/** Relay the MFA code into a held session and finish the login. */
export async function submitMfa(session, code) {
  const { context, page } = session;
  try {
    navLog("submitMfa: typing the code");
    await typeOtp(page, code);
    await advance(page, "otp");

    const step = await settleAfterSubmit(page);
    if (step === "chooser") return await nextChannel(session);
    return await finishSubmit(session, step);
  } catch (e) {
    navLog(`submitMfa: threw ${e.message}`);
    await closeSession(session).catch(() => {});
    return { status: STATUS.ERROR, message: e.message };
  }
}

async function finishSubmit(session, step) {
  if (step === "landed") {
    // Leave the browser open for the persistent manager to adopt.
    return { status: STATUS.SUCCESS, result: await captureResult(session.context, session.page), session };
  }
  if (step === "otp") {
    // Still on the code boxes: a genuine wrong code on the same channel.
    return { status: STATUS.MFA_REQUIRED, retry: true, channel: session.channel ?? "unknown" };
  }
  await closeSession(session);
  if (step === "arkose") return { status: STATUS.BLOCKED, message: "arkose" };
  return { status: STATUS.ERROR, message: `unexpected step: ${step}` };
}

/**
 * Code attempts allowed on ONE channel (initial send + resends) before falling through to the
 * next. A single mistyped or expired code is a typo, not a dead channel, so we resend on the SAME
 * channel and let the user try again; only then move on (email -> sms -> whatsapp -> call). The
 * backend caps the TOTAL same-channel tries (MAX_CODE_TRIES) independently.
 */
const MAX_ATTEMPTS_PER_CHANNEL = 2;

/** Every code channel except `keep` — forces reachCodeStep to resend on the SAME channel. */
const channelsExcept = (keep) => new Set(CHANNELS.map((c) => c.name).filter((n) => n !== keep));

/**
 * A rejected code lands back on the method chooser. Resend on the SAME channel first (one wrong
 * code must not burn the whole login); only after MAX_ATTEMPTS_PER_CHANNEL on it switch to the next
 * untried channel. A same-channel resend returns a plain retry (the backend counts it as a user
 * try); a switch is flagged `switched` so the backend does not and tells the user where the new
 * code went.
 */
async function nextChannel(session) {
  const tried = (session.channelsTried ??= new Set());
  const attempts = (session.channelAttempts ??= {});
  const cur = session.channel && session.channel !== "unknown" ? session.channel : null;

  if (cur) {
    attempts[cur] = (attempts[cur] ?? 0) + 1;
    if (attempts[cur] < MAX_ATTEMPTS_PER_CHANNEL) {
      navLog(`code rejected on ${cur}; resending a fresh code on the same channel (resend #${attempts[cur]})`);
      const resent = await reachCodeStep(session.page, channelsExcept(cur));
      if (resent.step === "otp") return { status: STATUS.MFA_REQUIRED, retry: true, channel: cur };
      if (resent.step === "landed" || resent.step === "arkose") return finishSubmit(session, resent.step);
      // The same channel no longer renders a code step — fall through and switch.
    }
    tried.add(cur);
  }

  navLog(`switching channel; tried=${[...tried].join(",") || "-"}`);
  const { step, channel } = await reachCodeStep(session.page, tried);
  if (step === "otp") {
    session.channel = channel;
    return { status: STATUS.MFA_REQUIRED, retry: true, channel, switched: true };
  }
  if (step === "landed" || step === "arkose") return finishSubmit(session, step);
  await closeSession(session);
  return { status: STATUS.WRONG_CODE, message: "channels_exhausted" };
}

/**
 * Close a login session. A REUSED one is the company's persistent browser (warm
 * re-auth): it is left running — closing it would take the whole company down.
 */
export async function closeSession(session) {
  if (session?.reused) return;
  await session?.browser?.close().catch(() => {});
}
