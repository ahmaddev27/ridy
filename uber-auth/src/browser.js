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
  BLOCKED: "blocked", // Uber's Arkose challenge: never solved, the manager is sent to the extension
  PASSWORD_REQUIRED: "password_required", // Uber asked for a password and we hold none
  CHANNEL_UNAVAILABLE: "channel_unavailable", // no code step reached (e.g. a chooser with no default)
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
async function advance(page) {
  const btn = continueButton(page);
  if (await isVisible(btn)) {
    await btn.click().catch(() => page.keyboard.press("Enter"));
  } else {
    await page.keyboard.press("Enter");
  }
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
    const text = page.getByText(/protecting your account|start puzzle|konto (wird )?gesch(ü|u)tzt|r(ä|a)tsel starten/i).first();
    if (await text.isVisible()) return true;
    return (await page.locator('iframe[src*="arkoselabs" i], iframe[src*="funcaptcha" i], [id*="arkose" i]').count()) > 0;
  } catch {
    return false;
  }
}

/**
 * Poll the page until one of the known steps is reached or the budget runs out.
 * @returns {'landed'|'password'|'otp'|'passkey'|'arkose'|'unknown'}
 */
export async function detectStep(page) {
  const deadline = Date.now() + config.stepTimeout;
  while (Date.now() < deadline) {
    if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) return "landed";
    if (await hasArkoseChallenge(page)) return "arkose";
    if (await isVisible(otpField(page))) return "otp";
    if (await isVisible(passwordField(page))) return "password";
    if (await hasPasskeyPrompt(page)) return "passkey";
    await page.waitForTimeout(500);
  }
  return "unknown";
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
 * Begin a login. On MFA the returned session keeps the browser open for
 * submitMfa(); otherwise it is closed before returning.
 *
 * Passwordless (no `password`): after the email Uber sends a code on its DEFAULT
 * channel and shows the code boxes; we never navigate a channel chooser. A
 * password step with no password to give, or a step we cannot recognise, ends
 * the attempt (password_required / channel_unavailable) rather than guessing.
 * `proxyUrl` is the company's residential proxy (the one the daemon uses).
 *
 * `reuse` = the company's persistent browser handle ({browser, context, page}): the
 * WARM re-authentication path. It rides the browser that already holds the company's
 * cookies and proxy (Uber shows "Welcome back", far less Arkose risk than a cold
 * login), and is never closed on failure — only its page state is abandoned.
 */
export async function startLogin({ email, password = null, proxyUrl = null, companyKey = null, reuse = null }) {
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

    // A remembered account ("Welcome back") may not ask for the identifier again.
    const idField = identifierField(page);
    if (await idField.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false)) {
      await idField.fill(email);
    }
    await advance(page);

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
    if (step === "passkey") {
      await closeSession(session);
      return { status: STATUS.PASSKEY_UNSUPPORTED };
    }
    if (step === "arkose") {
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
