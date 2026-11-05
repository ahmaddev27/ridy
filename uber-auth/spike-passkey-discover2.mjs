// THROWAWAY — Path B discovery #2. Register a FRESH passkey (so the injected credential is
// definitely on the account), inject it into a logged-out browser, and FULL-network-log every
// auth.uber.com / account.uber.com API call (FULL url + body + response) while the page's own
// conditional-UI passkey flow runs. If Uber's SPA completes the login after our authenticator
// signs, we capture the assertion-SUBMIT endpoint (the missing "finish") + the exact get-auth-options URL.
//
//   git show origin/spike/passkey-api:uber-auth/spike-passkey-discover2.mjs > ~/spike-passkey-discover2.mjs
//   docker cp ~/spike-passkey-discover2.mjs ridy-uber-auth-1:/app/spike-passkey-discover2.mjs
//   docker exec -w /app ridy-uber-auth-1 xvfb-run -a node spike-passkey-discover2.mjs 15 <uber_email>
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const companyKey = process.argv[2];
const email = process.argv[3] || "";
const stateDir = process.env.STATE_DIR || "./state";
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true };
const state = JSON.parse(await readFile(`${stateDir}/${companyKey}.json`, "utf8"));

// 1) register fresh + export the credential (guarantees the injected key is on the account)
const rb = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const rctx = await rb.newContext({ storageState: state, locale: "de-DE" });
const rpage = await rctx.newPage();
const rclient = await rctx.newCDPSession(rpage);
await rclient.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId: raid } = await rclient.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await rpage.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
if (rpage.url().indexOf("auth.uber.com") >= 0) { console.log("[spike] FAIL-auth"); await rb.close(); process.exit(3); }
const emailCaptured = await rpage.evaluate(async () => {
  const H = { "content-type": "application/json", "x-csrf-token": "x" };
  const b = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const u = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ro = await fetch("/api/getRegistrationOptions", { method: "POST", headers: H, body: "{}" }).then((r) => r.json());
  const o = ro.data.options; const alg = (p) => (p.alg && typeof p.alg === "object" ? p.alg.low : p.alg);
  const c = await navigator.credentials.create({ publicKey: { rp: o.rp, user: { id: b(o.user.id), name: o.user.display_name || "u", displayName: o.user.display_name || "u" }, challenge: b(o.challenge), pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })), timeout: 60000, attestation: "none", authenticatorSelection: { residentKey: "required", userVerification: "preferred" }, excludeCredentials: [] } });
  await fetch("/api/registerPublicKeyCredential", { method: "POST", headers: H, body: JSON.stringify({ attestation: { client_data_json: u(c.response.clientDataJSON), attestation_object: u(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : ["internal"] } }) });
  return o.user.display_name || "";
});
const cred = (await rclient.send("WebAuthn.getCredentials", { authenticatorId: raid })).credentials[0];
await rb.close();
const identifier = email || emailCaptured;
console.log("[spike] registered credId=" + cred.credentialId + " identifier=" + identifier);

// 2) logged-out browser + inject cred + FULL network log + let the page's conditional-UI run
const lb = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const lctx = await lb.newContext({ locale: "de-DE" });
const lpage = await lctx.newPage();
const lclient = await lctx.newCDPSession(lpage);
await lclient.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId: laid } = await lclient.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await lclient.send("WebAuthn.addCredential", { authenticatorId: laid, credential: cred });
lclient.on("WebAuthn.credentialAsserted", () => console.log("[spike] » credentialAsserted"));

const RE = /(account|auth)\.uber\.com.*(\/api\/|graphql|\/rt\/|webauthn|authenticate|credential|challenge|login|identity|submit|verify|session)/i;
lpage.on("request", (rq) => { const u = rq.url(); if (RE.test(u)) { const pd = rq.postData(); console.log("[REQ] " + rq.method() + " " + u.split("?")[0] + (pd ? " BODY=" + pd.slice(0, 200) : "")); } });
lpage.on("response", async (rs) => { const u = rs.url(); if (!RE.test(u)) return; let b = ""; try { b = (await rs.text()).slice(0, 200); } catch {} console.log("[RES] " + rs.status() + " " + u.split("?")[0] + " :: " + b.replace(/\s+/g, " ")); });

await lpage.goto("https://auth.uber.com/v2/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
await lpage.waitForTimeout(2500);
// type the identifier (real keystrokes) + click Weiter — this is what makes Uber present the passkey/method step
const field = lpage.getByPlaceholder(/phone number or email|telefonnummer oder e-mail/i).or(lpage.locator('input[type="email"], input[type="tel"], form input')).first();
await field.click({ timeout: 12000 }).catch(() => {});
await field.fill("").catch(() => {});
await field.pressSequentially(identifier, { delay: 40 }).catch(() => {});
await lpage.waitForTimeout(400);
const weiter = lpage.getByRole("button", { name: /\bweiter\b|continue|anmelden/i }).first();
if (await weiter.isVisible().catch(() => false)) await weiter.click().catch(() => {});
await lpage.waitForTimeout(2000);
if (await field.isVisible().catch(() => false)) await field.press("Enter").catch(() => {});
await lpage.waitForTimeout(5000);
// click any passkey affordance that appears on the method screen
for (const re of [/passkey|sicherheitsschl|mit einem schl|windows hello/i]) {
  const btn = lpage.getByRole("button", { name: re }).first();
  if (await btn.count().catch(() => 0)) { console.log("[spike] clicking passkey affordance"); await btn.click({ timeout: 4000 }).catch(() => {}); await lpage.waitForTimeout(4000); }
}
await lpage.waitForTimeout(4000);
const url = lpage.url();
console.log("[spike] FINAL url=" + url + (/supplier|vsdispatch|fleethub|drivers|account\.uber/.test(url) && !/auth\.uber/.test(url) ? "  ✅ LANDED" : "  ⚠️ still auth"));
console.log("[spike] body=" + (await lpage.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300));
await lb.close();
