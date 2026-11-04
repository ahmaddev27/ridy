// THROWAWAY — direct-API passkey register with the CSRF header Uber uses (x-csrf-token: "x").
// getRegistrationOptions -> navigator.credentials.create() (virtual authenticator) ->
// if CREATED, try candidate finish endpoints and report which persists. Run in
// ridy-uber-auth-1 with -e DISPLAY=:99 -w /app.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const companyKey = process.argv[2];
const stateDir = process.env.STATE_DIR || "./state";
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true };

const state = JSON.parse(await readFile(`${stateDir}/${companyKey}.json`, "utf8"));
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ storageState: state });
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });

page.on("response", async (r) => {
  const u = r.url();
  if (u.indexOf("account.uber.com/api/") >= 0) { let b = ""; try { b = (await r.text()).slice(0, 200); } catch {} console.log("[res] " + r.status() + " " + u.split("?")[0].replace("https://account.uber.com", "") + " :: " + b.replace(/\s+/g, " ")); }
});

await page.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
if (page.url().indexOf("auth.uber.com") >= 0) { console.log("[spike] FAIL-auth"); await browser.close(); process.exit(3); }
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  const H = { "content-type": "application/json", "x-csrf-token": "x", "x-uber-client-name": "uam_desktop", "x-uber-identity-entrypoint": "uam_desktop" };
  const b64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ab = (b) => btoa(String.fromCharCode.apply(null, new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ro = await fetch("/api/getRegistrationOptions", { method: "POST", headers: H, body: "{}" }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
  if (!ro || !ro.data || !ro.data.options) return { step: "options-failed", raw: JSON.stringify(ro).slice(0, 300) };
  const o = ro.data.options;
  const alg = (p) => (p.alg && typeof p.alg === "object") ? p.alg.low : p.alg;
  const pk = { rp: o.rp, user: { id: b64u(o.user.id), name: o.user.display_name || "user", displayName: o.user.display_name || "user" }, challenge: b64u(o.challenge), pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })), timeout: 60000, attestation: o.attestation || "none", authenticatorSelection: o.authenticatorSelection || { residentKey: "preferred", userVerification: "preferred" }, excludeCredentials: [] };
  let cred;
  try { const c = await navigator.credentials.create({ publicKey: pk }); cred = { id: c.id, rawId: ab(c.rawId), type: c.type, response: { attestationObject: ab(c.response.attestationObject), clientDataJSON: ab(c.response.clientDataJSON), transports: c.response.getTransports ? c.response.getTransports() : [] } }; }
  catch (e) { return { step: "CREATE-FAILED", error: String(e), name: e && e.name }; }
  const eps = ["/api/registerPasskey", "/api/createPasskey", "/api/addPasskey", "/api/finishRegistration", "/api/verifyPasskeyRegistration", "/api/finishPasskeyRegistration", "/api/savePasskey", "/api/storePasskey", "/api/completePasskeyRegistration"];
  const tries = [];
  for (const ep of eps) {
    const r = await fetch(ep, { method: "POST", headers: H, body: JSON.stringify(cred) }).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 160) })).catch((e) => ({ s: 0, b: String(e) }));
    tries.push(ep + " -> " + r.s + " " + r.b.replace(/\s+/g, " "));
    if (r.s === 200 && /success|"ok":true|publicKeyCredential/i.test(r.b)) { tries.push("*** LIKELY FINISH ENDPOINT: " + ep); break; }
  }
  return { step: "CREATED", id: cred.id, tries };
});
console.log("[result] " + JSON.stringify(result, null, 1).slice(0, 1600));

await page.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log("[spike] done (check the final getPasskeysInfo [res] above for publicKeyCredentials).");
await browser.close();
