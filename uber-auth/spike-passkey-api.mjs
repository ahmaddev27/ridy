// THROWAWAY — Option A: register the passkey via Uber's own API directly, bypassing
// the broken "Create a passkey" button. We fetch getRegistrationOptions, run
// navigator.credentials.create() ourselves (the CDP virtual authenticator answers),
// and report whether create() SUCCEEDS (we get an attestation) or REJECTS (and why).
// Run inside ridy-uber-auth-1 with -e DISPLAY=:99 -w /app.
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
  const isApi = u.indexOf("account.uber.com/api/") >= 0;
  if (isApi) { let b = ""; try { b = (await r.text()).slice(0, 350); } catch {} console.log(`[net] ${r.status()} ${r.request().method()} ${u.split("?")[0].replace("https://account.uber.com", "")} :: ${b.replace(/\s+/g, " ")}`); }
});

await page.goto("https://account.uber.com/passkeys", { waitUntil: "networkidle", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
if (page.url().indexOf("auth.uber.com") >= 0) { console.log("[spike] FAIL-auth: session does not cover account.uber.com"); await browser.close(); process.exit(3); }

const result = await page.evaluate(async () => {
  const b64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ab = (b) => btoa(String.fromCharCode.apply(null, new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ro = await fetch("/api/getRegistrationOptions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
  if (!ro || !ro.data || !ro.data.options) return { step: "options-failed", raw: JSON.stringify(ro).slice(0, 300) };
  const o = ro.data.options;
  const alg = (p) => (p.alg && typeof p.alg === "object") ? p.alg.low : p.alg;
  const pk = {
    rp: o.rp,
    user: { id: b64u(o.user.id), name: o.user.display_name || "user", displayName: o.user.display_name || "user" },
    challenge: b64u(o.challenge),
    pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })),
    timeout: 60000,
    attestation: o.attestation || "none",
    authenticatorSelection: o.authenticatorSelection || { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials: [],
  };
  try {
    const c = await navigator.credentials.create({ publicKey: pk });
    return { step: "CREATED", id: c.id, rawId: ab(c.rawId), type: c.type, attestationObject: ab(c.response.attestationObject), clientDataJSON: ab(c.response.clientDataJSON), transports: c.response.getTransports ? c.response.getTransports() : [] };
  } catch (e) {
    return { step: "CREATE-FAILED", error: String(e), name: e && e.name, rp: o.rp, params: o.pub_key_cred_params, authSel: pk.authenticatorSelection };
  }
});
console.log("[create-result] " + JSON.stringify(result).slice(0, 900));
await browser.close();
