// THROWAWAY Phase-2 spike — prove the stored SOFTWARE passkey logs in a FRESH, logged-out
// session with NO human. Reuses the PROVEN identifier-submit pattern from src/browser.js
// (type char-by-char, then CLICK "Weiter" — Enter alone is swallowed by Uber's React form).
// Pre-req: run spike-passkey-all.mjs <tenant> first → state/passkey-cred-<tenant>.json exists.
//
//   git show origin/spike/passkey-api:uber-auth/spike-passkey-login.mjs > ~/spike-passkey-login.mjs
//   docker cp ~/spike-passkey-login.mjs ridy-uber-auth-1:/app/spike-passkey-login.mjs
//   docker exec -w /app ridy-uber-auth-1 xvfb-run -a node spike-passkey-login.mjs 15   # email from stored cred
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const companyKey = process.argv[2];
const stateDir = process.env.STATE_DIR || "./state";
const cred = JSON.parse(await readFile(`${stateDir}/passkey-cred-${companyKey}.json`, "utf8"));
const identifier = process.argv[3] || cred.userName;
if (!identifier) { console.error("no identifier (pass as arg or store userName in the cred file)"); process.exit(1); }
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true };

// --- proven helpers mirrored from src/browser.js ---
const idField = (page) => page.getByPlaceholder(/phone number or email|telefonnummer oder e-mail/i).or(page.locator('input[type="email"], input[type="tel"], input[name="identifier" i]')).first();
const weiter = (page) => page.getByRole("button", { name: /continue|next|further|\bweiter\b|sign in|log ?in|anmelden|verify|bestätigen|absenden|submit/i }).first();
async function submitIdentifier(page, field, email) {
  await field.click().catch(() => {});
  await field.fill("").catch(() => {});
  await field.pressSequentially(email, { delay: 40 });
  await page.waitForTimeout(400);
  const b = weiter(page);
  if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});   // the click Uber actually needs
  await page.waitForTimeout(900);
  if (await field.isVisible().catch(() => false)) await field.press("Enter").catch(() => {});
  await page.waitForTimeout(800);
}
async function step(page) {
  const url = page.url();
  if (/supplier\.uber\.com|vsdispatch\.uber\.com|fleethub\.uber\.com|drivers\.uber\.com|account\.uber\.com/i.test(url) && !/auth\.uber\.com/i.test(url)) return "landed";
  if (await page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]').first().isVisible().catch(() => false)) return "otp";
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) return "password";
  if (await page.getByText(/passkey|security key|use your (phone|device)|windows hello|sicherheitsschl/i).first().isVisible().catch(() => false)) return "passkey";
  return "unknown";
}
const dump = async (page, t) => {
  console.log(`[dump:${t}] url=${page.url()}`);
  console.log(`[dump:${t}] controls=${JSON.stringify((await page.locator('button, a, [role="button"], [role="option"], [role="radio"], [role="menuitem"]').allInnerTexts().catch(() => [])).filter(Boolean).slice(0, 25))}`);
  console.log(`[dump:${t}] body=${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}`);
};

const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ locale: "de-DE" });     // fresh + logged OUT
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await client.send("WebAuthn.addCredential", { authenticatorId, credential: cred });
client.on("WebAuthn.credentialAsserted", () => console.log("[spike] » credentialAsserted — the authenticator SIGNED a navigator.credentials.get()"));
console.log(`[spike] injected ${cred.credentialId} (rpId=${cred.rpId}); identifier=${identifier}`);

await page.goto("https://auth.uber.com/v2/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
const field = idField(page);
await field.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
await submitIdentifier(page, field, identifier);

let s = await step(page);
console.log("[spike] step after identifier =", s);
await dump(page, "after-email");

// We WANT the passkey (opposite of cold-login, which avoids it). Click any passkey affordance to fire get().
const pkRe = /passkey|sicherheitsschl|windows hello|security key|mit einem schl|mit passkey|anmelden mit/i;
const tryClick = async (loc, label) => { if (await loc.count().catch(() => 0)) { console.log("[spike] click:", label); await loc.first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(3500); return true; } return false; };

if (s !== "landed") {
  let did = await tryClick(page.getByRole("button", { name: pkRe }), "passkey-button");
  if (!did) did = await tryClick(page.getByText(pkRe), "passkey-text");
  if (!did) {
    // behind a "more options" / method chooser
    if (await tryClick(page.getByRole("button", { name: /weitere option|andere option|another way|more option|andere.*methode|try another/i }), "more-options")) {
      await dump(page, "chooser");
      await tryClick(page.getByText(pkRe), "passkey-in-chooser");
    }
  }
}
await page.waitForTimeout(3000);
await dump(page, "final");
const url = page.url();
console.log("[spike] FINAL:", (/supplier\.uber\.com|vsdispatch\.uber\.com|fleethub\.uber\.com|drivers\.uber\.com|account\.uber\.com/i.test(url) && !/auth\.uber\.com/i.test(url)) ? "✅ LANDED " + url : "⚠️ stuck " + url);
await browser.close();
