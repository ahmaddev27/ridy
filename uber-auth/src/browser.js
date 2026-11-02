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
      name: /continue|next|further|weiter|sign in|log ?in|anmelden|verify|bestätigen|absenden|submit/i,
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
      .getByText(
        /willkommen zur(ü|u)ck|welcome back|w(ä|a)hle eine andere|andere bestätigungs?methode|another (verification )?method|weitere optionen|more options/i,
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
  if (await hasPasskeyPrompt(page)) return "passkey";
  // After arkose/otp/password/passkey so it never shadows them; arkose above guards the challenge.
  if (await hasChannelChoice(page)) return "channel_choice";
  return null;
}

// --- Co-browse: a human solves Arkose in THIS browser (docs/28) ---------------------------
export const CHALLENGE_MAX_RETRIES = 3;
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
  if (step && step !== "arkose") return step;
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
export const NAV_MAX_HOPS = 3;
const NAV_CLICK_WAIT_MS = 3000; // how long a control may take to appear
const NAV_SETTLE_MS = 5000; // how long a click may take to land on a recognisable step
const NAV_CLICKABLE = 'button, a, [role="button"], [role="link"], [role="option"], [role="radio"], [role="menuitem"], li, label';

// "Open the method list" controls. Tuned from the live German UI ("Weitere Optionen" ->
// "Wähle eine andere Bestätigungsmethode"). Deliberately NOT a bare `code`: that matched the
// SMS button ("Code per Textnachricht versenden") and would have sent the code to a phone.
export const ANOTHER_WAY_RE =
  /try another way|another way|more options|other options|weitere optionen|alle optionen( anzeigen)?|use another method|sign in another way|verify another way|use a code|sign in with a code|w(ä|a)hle eine andere|andere (option|bestätigungs?methode)|anders anmelden|stattdessen/i;
// The email option within the method list ("E-Mail"). The adjacent "send code"/"code senden"
// forms never match the German SMS/WhatsApp items, which put words between "Code" and "senden".
export const EMAIL_OPTION_RE =
  /e-?mail|send code|get a code|verification code|code to your email|per e-?mail|code senden/i;

const navLog = (m) => console.log(`[pwless-nav] ${m}`);

/**
 * Failure-path diagnostic: log the current screen's chrome (url, title, headings, control
 * labels) so the text selectors above can be tuned from the log instead of guessed. Fires only
 * when a step is not recognised. Never logs PII: emails and any run of digits are redacted.
 */
async function dumpScreen(page, where) {
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
    const shot = `/tmp/pwless-${where.replace(/[^a-z0-9]+/gi, "-")}.png`;
    await page.screenshot({ path: shot, fullPage: false }).then(() => navLog(`screenshot=${shot}`)).catch((e) => navLog(`screenshot failed: ${e.message}`));
  } catch (e) {
    navLog(`dumpScreen failed @ ${where}: ${e.message}`);
  }
}

/** First visible+enabled clickable whose text matches `re`; returns {el, text} or null. Never logs PII. */
async function findControl(page, re) {
  const deadline = Date.now() + NAV_CLICK_WAIT_MS;
  do {
    try {
      const all = await page.locator(NAV_CLICKABLE).filter({ hasText: re }).all();
      for (const el of all) {
        if ((await isVisible(el)) && (await el.isEnabled().catch(() => false))) {
          const text = ((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 60);
          return { el, text };
        }
      }
    } catch {
      /* page mid-navigation: retry until the deadline */
    }
    await page.waitForTimeout(400);
  } while (Date.now() < deadline);
  return null;
}

/** Click the control; returns the (truncated) matched label, or null when none is clickable. */
export async function clickControl(page, re) {
  const found = await findControl(page, re);
  if (!found) return null;
  await found.el.click({ timeout: 3000 }).catch(() => {});
  return found.text || "(no text)";
}

/** Poll briefly after a click for a decisive step; null = still on a passkey/unknown screen. */
async function settleStep(page) {
  const deadline = Date.now() + NAV_SETTLE_MS;
  while (Date.now() < deadline) {
    if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) return "landed";
    if (await hasArkoseChallenge(page)) return "arkose";
    if (await isVisible(otpField(page))) return "otp";
    await page.waitForTimeout(400);
  }
  return null;
}

/**
 * From a passkey step OR a "Welcome back" method chooser, try to reach the email code step
 * (<= NAV_MAX_HOPS clicks). Each hop prefers the email/code option (we may already be on the
 * method list), else opens the "another way" list. Returns the final step
 * ('otp'|'landed'|'arkose'|'passkey'). `ops` is injectable for tests.
 */
export async function navigatePastPasskey(page, ops = {}) {
  const click = ops.click ?? clickControl;
  const settle = ops.settle ?? settleStep;
  navLog("navigating to the email code step");
  for (let hop = 1; hop <= NAV_MAX_HOPS; hop++) {
    let kind = "email-option";
    let label = await click(page, EMAIL_OPTION_RE);
    if (!label) {
      kind = "another-way";
      label = await click(page, ANOTHER_WAY_RE);
    }
    if (!label) {
      navLog(`hop ${hop}: no email-option/another-way control found; falling back to passkey_unsupported`);
      return "passkey";
    }
    const step = await settle(page);
    navLog(`hop ${hop}: clicked ${kind} "${label}"; step after=${step ?? "passkey/unknown"}`);
    if (step) return step;
  }
  navLog(`gave up after ${NAV_MAX_HOPS} hops; falling back to passkey_unsupported`);
  return "passkey";
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
export async function startLogin({ email, password = null, proxyUrl = null, companyKey = null, reuse = null, cold = false, cobrowse = false }) {
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
      return { status: STATUS.MFA_REQUIRED, session };
    }
    // "Welcome back" method chooser or a passkey-first account: navigate to the email code step.
    if ((step === "channel_choice" || step === "passkey") && !password) {
      step = await navigatePastPasskey(page);
      if (step === "landed") return { status: STATUS.SUCCESS, result: await captureResult(context, page), session };
      if (step === "otp") return { status: STATUS.MFA_REQUIRED, session };
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
    await typeOtp(page, code);
    await advance(page);

    const step = await detectStep(page);
    if (step === "landed") {
      const result = await captureResult(context, page);
      // Leave the browser open for the persistent manager to adopt.
      return { status: STATUS.SUCCESS, result, session };
    }
    if (step === "otp") {
      // Still on the code step — wrong/expired code.
      return { status: STATUS.MFA_REQUIRED, retry: true };
    }

    await closeSession(session);
    if (step === "arkose") return { status: STATUS.BLOCKED, message: "arkose" };
    return { status: STATUS.ERROR, message: `unexpected step: ${step}` };
  } catch (e) {
    await closeSession(session).catch(() => {});
    return { status: STATUS.ERROR, message: e.message };
  }
}

/**
 * Close a login session. A REUSED one is the company's persistent browser (warm
 * re-auth): it is left running — closing it would take the whole company down.
 */
export async function closeSession(session) {
  if (session?.reused) return;
  await session?.browser?.close().catch(() => {});
}
