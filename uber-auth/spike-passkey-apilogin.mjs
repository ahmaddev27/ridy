// THROWAWAY — Path B: headless passkey LOGIN via Uber's own WebAuthn login API on
// /rt/webauthn-api/, no human, no UI. The page calls POST /rt/webauthn-api/get-auth-options
// (returns a challenge) but NEVER posts the assertion to a finish endpoint on its own, so the
// UI login never completes. We do the finish ourselves: get-auth-options -> navigator.credentials.get()
// -> POST the assertion to candidate finish endpoints and report which one logs us in.
//
//   git show origin/spike/passkey-api:uber-auth/spike-passkey-apilogin.mjs > ~/spike-passkey-apilogin.mjs
//   docker cp ~/spike-passkey-apilogin.mjs ridy-uber-auth-1:/app/spike-passkey-apilogin.mjs
//   docker exec -w /app ridy-uber-auth-1 xvfb-run -a node spike-passkey-apilogin.mjs 15
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const companyKey = process.argv[2];
const stateDir = process.env.STATE_DIR || "./state";
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true };
const state = JSON.parse(await readFile(`${stateDir}/${companyKey}.json`, "utf8"));

// ---- 1) REGISTER a fresh passkey on the live session + export it (guarantees the login key matches) ----
const rb = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const rctx = await rb.newContext({ storageState: state, locale: "de-DE" });
const rpage = await rctx.newPage();
const rclient = await rctx.newCDPSession(rpage);
await rclient.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId: raid } = await rclient.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await rpage.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
if (rpage.url().indexOf("auth.uber.com") >= 0) { console.log("[spike] FAIL-auth (session expired)"); await rb.close(); process.exit(3); }
const reg = await rpage.evaluate(async () => {
  const H = { "content-type": "application/json", "x-csrf-token": "x" };
  const b64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ro = await fetch("/api/getRegistrationOptions", { method: "POST", headers: H, body: "{}" }).then((r) => r.json());
  const o = ro.data.options; const alg = (p) => (p.alg && typeof p.alg === "object" ? p.alg.low : p.alg);
  const pk = { rp: o.rp, user: { id: b64u(o.user.id), name: o.user.display_name || "u", displayName: o.user.display_name || "u" }, challenge: b64u(o.challenge), pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })), timeout: 60000, attestation: o.attestation || "none", authenticatorSelection: o.authenticatorSelection || { residentKey: "required", userVerification: "preferred" }, excludeCredentials: [] };
  const c = await navigator.credentials.create({ publicKey: pk });
  const body = { attestation: { client_data_json: url(c.response.clientDataJSON), attestation_object: url(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : ["internal"] } };
  await fetch("/api/registerPublicKeyCredential", { method: "POST", headers: H, body: JSON.stringify(body) });
  return { id: c.id };
});
const got = await rclient.send("WebAuthn.getCredentials", { authenticatorId: raid });
const cred = (got.credentials || [])[0];
await rb.close();
if (!cred) { console.log("[spike] no credential exported"); process.exit(2); }
console.log("[spike] registered+exported credId=" + cred.credentialId);

// ---- 2) FRESH logged-out context + inject the credential + do the API login finish ourselves ----
const lb = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const lctx = await lb.newContext({ locale: "de-DE" });
const lpage = await lctx.newPage();
const lclient = await lctx.newCDPSession(lpage);
await lclient.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId: laid } = await lclient.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await lclient.send("WebAuthn.addCredential", { authenticatorId: laid, credential: cred });
await lpage.goto("https://auth.uber.com/v2/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
await lpage.waitForTimeout(1500);

const result = await lpage.evaluate(async () => {
  const H = { "content-type": "application/json", "x-csrf-token": "x" };
  const dec = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const u = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const out = { steps: [] };
  // get-auth-options (usernameless first)
  let ro;
  try { ro = await fetch("/rt/webauthn-api/get-auth-options", { method: "POST", headers: H, body: "{}" }).then((r) => r.json()); }
  catch (e) { return { err: "get-auth-options: " + String(e) }; }
  out.options = JSON.stringify(ro).slice(0, 500);
  const o = (ro && ro.options) || ro;
  if (!o || !o.challenge) return out;
  const timeout = (o.timeout && typeof o.timeout === "object") ? o.timeout.low : (o.timeout || 60000);
  const allow = (o.allowCredentials || o.allow_credentials || []).map((c) => ({ type: "public-key", id: dec(c.id), transports: c.transports }));
  const pk = { challenge: dec(o.challenge), rpId: o.rpId || (o.rp && o.rp.id) || "uber.com", allowCredentials: allow, userVerification: o.userVerification || "preferred", timeout };
  let a;
  try { a = await navigator.credentials.get({ publicKey: pk }); }
  catch (e) { out.getError = String(e); return out; }
  const r = a.response;
  // standard WebAuthn assertion JSON, base64url
  const assertion = { id: a.id, rawId: u(a.rawId), type: a.type, response: { clientDataJSON: u(r.clientDataJSON), authenticatorData: u(r.authenticatorData), signature: u(r.signature), userHandle: r.userHandle ? u(r.userHandle) : null } };
  const bodies = [
    ["flat", assertion],
    ["wrap-credential", { credential: assertion }],
    ["wrap-assertion", { assertion }],
    ["snake", { id: a.id, raw_id: u(a.rawId), type: a.type, response: { client_data_json: u(r.clientDataJSON), authenticator_data: u(r.authenticatorData), signature: u(r.signature), user_handle: r.userHandle ? u(r.userHandle) : null } }],
  ];
  const endpoints = ["verify-auth", "verify-auth-options", "authenticate", "auth", "verify", "validate-auth", "finish-auth", "complete-auth", "login", "verify-authentication", "assert"];
  for (const ep of endpoints) {
    for (const [tag, body] of bodies) {
      let s = 0, b = "";
      try { const res = await fetch("/rt/webauthn-api/" + ep, { method: "POST", headers: H, body: JSON.stringify(body) }); s = res.status; b = (await res.text()).slice(0, 160); } catch (e) { b = String(e); }
      if (s && s !== 404) out.steps.push(ep + " [" + tag + "] -> " + s + " " + b.replace(/\s+/g, " "));
      if (s === 200 && !/error|invalid|fail/i.test(b)) { out.hit = ep + " [" + tag + "]"; return out; }
    }
  }
  return out;
});
console.log("[apilogin] " + JSON.stringify(result, null, 1).slice(0, 2600));
await lpage.waitForTimeout(1500);
console.log("[apilogin] final url=" + lpage.url() + " cookies=" + (await lctx.cookies()).filter((c) => /session|sid|csid/i.test(c.name)).map((c) => c.name).join(","));
await lb.close();
