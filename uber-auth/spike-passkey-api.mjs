// THROWAWAY — finish passkey registration with the EXACT shape from Uber's JS:
// registerPublicKeyCredential({ request: { attestation: { client_data_json, attestation_object, transports } } })
// (snake_case Thrift binary = base64). Try standard-base64 then base64url. Success persists.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

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

page.on("response", async (r) => { const u = r.url(); if (u.indexOf("account.uber.com/api/getPasskeysInfo") >= 0) { let b = ""; try { b = (await r.text()).slice(0, 300); } catch {} console.log("[info] " + r.status() + " :: " + b.replace(/\s+/g, " ")); } });

await page.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
if (page.url().indexOf("auth.uber.com") >= 0) { console.log("[spike] FAIL-auth"); await browser.close(); process.exit(3); }
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  const H = { "content-type": "application/json", "x-csrf-token": "x", "x-uber-client-name": "uam_desktop", "x-uber-identity-entrypoint": "uam_desktop" };
  const b64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const std = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const url = (buf) => std(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ro = await fetch("/api/getRegistrationOptions", { method: "POST", headers: H, body: "{}" }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
  if (!ro || !ro.data || !ro.data.options) return { step: "options-failed", raw: JSON.stringify(ro).slice(0, 300) };
  const o = ro.data.options;
  const alg = (p) => (p.alg && typeof p.alg === "object") ? p.alg.low : p.alg;
  const pk = { rp: o.rp, user: { id: b64u(o.user.id), name: o.user.display_name || "user", displayName: o.user.display_name || "user" }, challenge: b64u(o.challenge), pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })), timeout: 60000, attestation: o.attestation || "none", authenticatorSelection: o.authenticatorSelection || { residentKey: "preferred", userVerification: "preferred" }, excludeCredentials: [] };
  let c;
  try { c = await navigator.credentials.create({ publicKey: pk }); }
  catch (e) { return { step: "CREATE-FAILED", error: String(e) }; }
  const transports = c.response.getTransports ? c.response.getTransports() : ["internal"];
  const post = (body) => fetch("/api/registerPublicKeyCredential", { method: "POST", headers: H, body: JSON.stringify(body) }).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 320) })).catch((e) => ({ s: 0, b: String(e) }));
  const real = (b) => /"status":"success"/.test(b) && !/recoverableError|went wrong|BAD_REQUEST|required|invalid/i.test(b);
  const attempts = [
    ["std", { attestation: { client_data_json: std(c.response.clientDataJSON), attestation_object: std(c.response.attestationObject), transports } }],
    ["url", { attestation: { client_data_json: url(c.response.clientDataJSON), attestation_object: url(c.response.attestationObject), transports } }],
    ["std,no-transports", { attestation: { client_data_json: std(c.response.clientDataJSON), attestation_object: std(c.response.attestationObject) } }],
    ["std,+id", { attestation: { id: c.id, raw_id: url(c.rawId), client_data_json: std(c.response.clientDataJSON), attestation_object: std(c.response.attestationObject), transports } }],
  ];
  const tries = [];
  let persisted = false;
  for (const [tag, body] of attempts) {
    const r = await post(body);
    tries.push(tag + " -> " + r.s + " " + r.b.replace(/\s+/g, " "));
    if (r.s === 200 && real(r.b)) { tries.push("*** TRUE SUCCESS (" + tag + ")"); persisted = true; break; }
  }
  // confirm via getPasskeysInfo
  const info = await fetch("/api/getPasskeysInfo", { method: "POST", headers: H, body: "{}" }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
  const n = (((info || {}).data || {}).publicKeyCredentials || []).length;
  return { step: "CREATED", id: c.id, persistedGuess: persisted, passkeysNow: n, tries };
});
console.log("[result]\n" + JSON.stringify(result, null, 1).slice(0, 2200));

// Phase-2 prep: export the credential (incl. the PKCS#8 private key) so a future
// logged-out session can re-inject it and log in with NO human. The virtual
// authenticator holds the key in memory only — without this it dies with the browser.
if (result.persistedGuess || (result.passkeysNow || 0) > 0) {
  try {
    const { credentials } = await client.send("WebAuthn.getCredentials", { authenticatorId });
    if (credentials && credentials.length) {
      const out = `${stateDir}/passkey-cred-${companyKey}.json`;
      await writeFile(out, JSON.stringify(credentials[0], null, 2));
      console.log(`[persist] wrote ${out} — credId=${credentials[0].credentialId} rpId=${credentials[0].rpId} hasPrivateKey=${!!credentials[0].privateKey}`);
    } else {
      console.log("[persist] getCredentials returned none — cannot export the private key");
    }
  } catch (e) { console.log("[persist] error: " + e.message); }
}

await page.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log("[spike] done — [info] publicKeyCredentials non-empty = PERSISTED.");
await browser.close();
