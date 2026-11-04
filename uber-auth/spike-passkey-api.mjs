// THROWAWAY — diagnose the passkey REGISTER flow server-side. Captures the CSRF
// header Uber's own getRegistrationOptions request carries, any finish/register POST,
// console errors (to catch a create() rejection), and the final getPasskeysInfo so we
// see if a credential persisted. Run in ridy-uber-auth-1 with -e DISPLAY=:99 -w /app.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const companyKey = process.argv[2];
const stateDir = process.env.STATE_DIR || "./state";
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true };

const state = JSON.parse(await readFile(`${stateDir}/${companyKey}.json`, "utf8"));
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ storageState: state });
const page = await context.newPage();

page.on("request", (req) => {
  const u = req.url();
  if (u.indexOf("account.uber.com/api/") >= 0 && req.method() === "POST") {
    const h = req.headers();
    const picked = {};
    for (const k of Object.keys(h)) { if (/csrf|xsrf|token|csid|x-uber|x-csrf/i.test(k)) picked[k] = h[k]; }
    console.log("[req] " + u.split("?")[0].replace("https://account.uber.com", "") + " hdrs=" + JSON.stringify(picked) + " body=" + (req.postData() || "").slice(0, 160));
  }
});
page.on("response", async (r) => {
  const u = r.url();
  if (u.indexOf("account.uber.com/api/") >= 0) { let b = ""; try { b = (await r.text()).slice(0, 220); } catch {} console.log("[res] " + r.status() + " " + u.split("?")[0].replace("https://account.uber.com", "") + " :: " + b.replace(/\s+/g, " ")); }
});
page.on("console", (m) => { if (m.type() === "error") console.log("[err] " + m.text().slice(0, 180)); });
page.on("pageerror", (e) => console.log("[pageerror] " + e.message.slice(0, 180)));

const client = await context.newCDPSession(page);
await client.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
client.on("WebAuthn.credentialAdded", () => console.log("[spike] credentialAdded (ceremony ran)"));
client.on("WebAuthn.credentialAsserted", () => console.log("[spike] credentialAsserted"));

await page.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
if (page.url().indexOf("auth.uber.com") >= 0) { console.log("[spike] FAIL-auth"); await browser.close(); process.exit(3); }
await page.waitForTimeout(2500);

// Let Uber's OWN JS run the full create flow (it carries the CSRF). We only click.
await page.getByRole("button", { name: /^create a passkey$/i }).first().click({ timeout: 15000 }).catch((e) => console.log("page-btn:", e.message));
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /create a passkey/i }).last().click({ timeout: 8000 }).catch((e) => console.log("modal-btn:", e.message));
console.log("[spike] clicked; watching for a register/finish POST ...");
await page.waitForTimeout(9000);

// Re-navigate so the page re-reads getPasskeysInfo (with CSRF) -> shows if it persisted.
await page.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
console.log("[spike] done.");
await browser.close();
