// THROWAWAY Phase-2 spike — prove the SOFTWARE passkey (exported by spike-passkey-api.mjs
// to state/passkey-cred-<companyKey>.json) can LOG IN a FRESH, logged-out session with NO
// human, NO co-browse, NO cold-login. Run INSIDE the uber-auth container. DELETE after go/no-go.
//
//   git show origin/spike/passkey-api:uber-auth/spike-passkey-login.mjs > ~/spike-passkey-login.mjs
//   docker cp ~/spike-passkey-login.mjs ridy-uber-auth-1:/app/spike-passkey-login.mjs
//   docker exec -e DISPLAY=:99 -w /app ridy-uber-auth-1 node spike-passkey-login.mjs 15 <uber_email>
//
// Pre-req: run spike-passkey-api.mjs <companyKey> FIRST so passkey-cred-<companyKey>.json exists.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const companyKey = process.argv[2];
const email = process.argv[3];
if (!companyKey || !email) { console.error("usage: node spike-passkey-login.mjs <companyKey> <uber_email>"); process.exit(1); }

const stateDir = process.env.STATE_DIR || "./state";
const credential = JSON.parse(await readFile(`${stateDir}/passkey-cred-${companyKey}.json`, "utf8"));
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };

const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ locale: "de-DE" });   // fresh + logged OUT (no cookies)
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await client.send("WebAuthn.addCredential", { authenticatorId, credential });   // inject the stored software passkey
client.on("WebAuthn.credentialAsserted", () => console.log("[spike] » credentialAsserted (client-side — NOT proof Uber accepted; the landed URL is)"));
console.log(`[spike] injected credential ${credential.credentialId} (rpId=${credential.rpId}) into a fresh logged-out browser.`);

await page.goto("https://auth.uber.com/v2/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("[spike] nav: " + e.message));

// Type the email with real keystrokes (Uber's v2 form is a React controlled input).
const emailSel = 'input[name="identifierTextField"], input[type="email"], input[autocomplete="username"], input[inputmode="email"], form input';
const field = page.locator(emailSel).first();
await field.click({ timeout: 15000 }).catch(() => {});
await field.pressSequentially(email, { delay: 40 }).catch((e) => console.log("[spike] type note: " + e.message));
await page.keyboard.press("Enter").catch(() => {});
await page.waitForTimeout(3000);

// Walk any "continue with a passkey" / "weiter" affordance; a discoverable credential often
// auto-triggers navigator.credentials.get(), which the virtual authenticator answers.
for (const re of [/passkey/i, /passwort|sicherheitsschl/i, /^continue$/i, /^weiter$/i, /sign in|anmelden/i]) {
  const btn = page.getByRole("button", { name: re }).first();
  if (await btn.count().catch(() => 0)) { await btn.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(2500); }
}
await page.waitForTimeout(3000);

const url = page.url();
console.log("[spike] final url: " + url);
if (/supplier\.uber\.com|vsdispatch\.uber\.com|account\.uber\.com|fleethub\.uber\.com|drivers\.uber\.com/i.test(url) && !/auth\.uber\.com/i.test(url)) {
  console.log("[spike] ✅ SUCCESS — logged in via the SOFTWARE passkey, no human. Full re-auth loop proven.");
} else {
  console.log("[spike] ⚠️ still on an auth URL — dumping visible buttons to tune the flow:");
  console.log("[spike] buttons:", await page.getByRole("button").allInnerTexts().catch(() => []));
  console.log("[spike] body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
}
await browser.close();
