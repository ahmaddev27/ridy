// Drives a real Chromium through Uber's fleet sign-in. Because Uber splits the
// flow across email -> password -> optional MFA and blocks headless automation
// with a code, the browser is held open between HTTP calls so a human can relay
// the MFA code. Nothing here decides business logic — it returns a status and,
// on success, the captured cookies + org uuid.

import { chromium } from "playwright";
import { config } from "./config.js";

export const STATUS = {
  SUCCESS: "success",
  MFA_REQUIRED: "mfa_required",
  PASSKEY_UNSUPPORTED: "passkey_unsupported",
  BAD_CREDENTIALS: "bad_credentials",
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
async function launchBrowser() {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
  ];
  // Prefer the real installed Chrome — far less likely to be flagged than the
  // bundled Chromium. Fall back to Chromium if Chrome is not present.
  try {
    return await chromium.launch({ headless: !config.headful, channel: "chrome", args });
  } catch {
    return await chromium.launch({ headless: !config.headful, args });
  }
}

async function newStealthContext(browser) {
  const context = await browser.newContext({
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
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
 * Poll the page until one of the known steps is reached or the budget runs out.
 * @returns {'landed'|'password'|'otp'|'passkey'|'unknown'}
 */
async function detectStep(page) {
  const deadline = Date.now() + config.stepTimeout;
  while (Date.now() < deadline) {
    if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) return "landed";
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
 */
export async function startLogin({ email, password }) {
  const browser = await launchBrowser();
  const context = await newStealthContext(browser);
  const page = await context.newPage();
  page.setDefaultTimeout(config.stepTimeout);
  const session = { browser, context, page, createdAt: Date.now() };

  try {
    await page.goto(config.dashboardUrl, { waitUntil: "domcontentloaded" });

    // Already authenticated (stored cookies) — nothing to do.
    if (!/auth\.uber|\/(auth|login|oauth)/i.test(page.url())) {
      const result = await captureResult(context, page);
      await browser.close();
      return { status: STATUS.SUCCESS, result };
    }

    await identifierField(page).fill(email);
    await advance(page);

    let step = await detectStep(page);

    if (step === "password") {
      await passwordField(page).fill(password);
      await advance(page);
      step = await detectStep(page);
    }

    if (step === "landed") {
      const result = await captureResult(context, page);
      await browser.close();
      return { status: STATUS.SUCCESS, result };
    }
    if (step === "otp") {
      return { status: STATUS.MFA_REQUIRED, session };
    }
    if (step === "passkey") {
      await browser.close();
      return { status: STATUS.PASSKEY_UNSUPPORTED };
    }

    await browser.close();
    return { status: STATUS.BAD_CREDENTIALS };
  } catch (e) {
    await browser.close().catch(() => {});
    return { status: STATUS.ERROR, message: e.message };
  }
}

/** Relay the MFA code into a held session and finish the login. */
export async function submitMfa(session, code) {
  const { browser, context, page } = session;
  try {
    await typeOtp(page, code);
    await advance(page);

    const step = await detectStep(page);
    if (step === "landed") {
      const result = await captureResult(context, page);
      await browser.close();
      return { status: STATUS.SUCCESS, result };
    }
    if (step === "otp") {
      // Still on the code step — wrong/expired code.
      return { status: STATUS.MFA_REQUIRED, retry: true };
    }

    await browser.close();
    return { status: STATUS.ERROR, message: `unexpected step: ${step}` };
  } catch (e) {
    await browser.close().catch(() => {});
    return { status: STATUS.ERROR, message: e.message };
  }
}

export async function closeSession(session) {
  await session?.browser?.close().catch(() => {});
}
