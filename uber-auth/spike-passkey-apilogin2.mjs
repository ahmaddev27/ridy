// THROWAWAY — Path B step 2. We now know get-auth-options wants headers
// {x-uber-client-name: usl_desktop, x-uber-request-uuid: <uuid>, content-type: json} and body
// {"request":{}} (NOT {}), and there is NO webauthn-api finish endpoint — the assertion is
// submitted through Uber's GENERIC login flow. This spike: (1) calls get-auth-options correctly
// and prints the real options, (2) signs with navigator.credentials.get(), (3) searches the
// loaded JS for how/where the assertion is submitted (the generic finish), printing rich context.
//
//   git show origin/spike/passkey-api:uber-auth/spike-passkey-apilogin2.mjs > ~/spike-passkey-apilogin2.mjs
//   docker cp ~/spike-passkey-apilogin2.mjs ridy-uber-auth-1:/app/spike-passkey-apilogin2.mjs
//   docker exec -w /app ridy-uber-auth-1 xvfb-run -a node spike-passkey-apilogin2.mjs 15
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const companyKey = process.argv[2];
const stateDir = process.env.STATE_DIR || "./state";
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true };
const state = JSON.parse(await readFile(`${stateDir}/${companyKey}.json`, "utf8"));

// 1) register fresh + export (match guaranteed)
const rb = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const rctx = await rb.newContext({ storageState: state, locale: "de-DE" });
const rpage = await rctx.newPage();
const rclient = await rctx.newCDPSession(rpage);
await rclient.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId: raid } = await rclient.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await rpage.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
if (rpage.url().indexOf("auth.uber.com") >= 0) { console.log("[spike] FAIL-auth"); await rb.close(); process.exit(3); }
await rpage.evaluate(async () => {
  const H = { "content-type": "application/json", "x-csrf-token": "x" };
  const b = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const u = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ro = await fetch("/api/getRegistrationOptions", { method: "POST", headers: H, body: "{}" }).then((r) => r.json());
  const o = ro.data.options; const alg = (p) => (p.alg && typeof p.alg === "object" ? p.alg.low : p.alg);
  const c = await navigator.credentials.create({ publicKey: { rp: o.rp, user: { id: b(o.user.id), name: o.user.display_name || "u", displayName: o.user.display_name || "u" }, challenge: b(o.challenge), pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })), timeout: 60000, attestation: "none", authenticatorSelection: { residentKey: "required", userVerification: "preferred" }, excludeCredentials: [] } });
  await fetch("/api/registerPublicKeyCredential", { method: "POST", headers: H, body: JSON.stringify({ attestation: { client_data_json: u(c.response.clientDataJSON), attestation_object: u(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : ["internal"] } }) });
});
const cred = (await rclient.send("WebAuthn.getCredentials", { authenticatorId: raid })).credentials[0];
await rb.close();
console.log("[spike] credId=" + cred.credentialId);

// 2) fresh logged-out + inject + correct get-auth-options + get() + JS search for the finish
const lb = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const lctx = await lb.newContext({ locale: "de-DE" });
const lpage = await lctx.newPage();
const lclient = await lctx.newCDPSession(lpage);
await lclient.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId: laid } = await lclient.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
await lclient.send("WebAuthn.addCredential", { authenticatorId: laid, credential: cred });
await lpage.goto("https://auth.uber.com/v2/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("nav:", e.message));
await lpage.waitForTimeout(2500);

const r = await lpage.evaluate(async () => {
  const out = {};
  const dec = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const uid = (crypto.randomUUID && crypto.randomUUID()) || ("" + Date.now());
  const H = { "content-type": "application/json", "x-uber-client-name": "usl_desktop", "x-uber-request-uuid": uid };
  let ro;
  try { ro = await fetch("/rt/webauthn-api/get-auth-options", { method: "POST", headers: H, body: JSON.stringify({ request: {} }) }); out.gaoStatus = ro.status; const t = await ro.text(); try { ro = JSON.parse(t); out.options = JSON.stringify(ro).slice(0, 600); } catch { out.optionsRaw = t.slice(0, 200); return out; } }
  catch (e) { out.gaoErr = String(e); return out; }
  const o = (ro && ro.options) || ro;
  if (o && o.challenge) {
    try {
      const to = (o.timeout && typeof o.timeout === "object") ? o.timeout.low : (o.timeout || 60000);
      const a = await navigator.credentials.get({ publicKey: { challenge: dec(o.challenge), rpId: o.rpId || (o.rp && o.rp.id) || "uber.com", allowCredentials: (o.allowCredentials || []).map((c) => ({ type: "public-key", id: dec(c.id) })), userVerification: o.userVerification || "preferred", timeout: to } });
      out.signed = !!a; out.credIdUsed = a.id;
    } catch (e) { out.getErr = String(e); }
  }
  // search JS for how the assertion is submitted (the generic finish)
  const srcs = Array.from(document.querySelectorAll("script[src]")).map((s) => s.src);
  const hits = [];
  for (const src of srcs) {
    let txt = ""; try { txt = await fetch(src).then((x) => x.text()); } catch { continue; }
    for (const kw of ["get-auth-options", "authenticatorData", "authenticator_data", "credentials.get", "userHandle", "user_handle", "assertion"]) {
      let i = txt.indexOf(kw);
      if (i >= 0 && hits.length < 10) hits.push(kw + " :: " + txt.slice(Math.max(0, i - 80), i + 220).replace(/\s+/g, " "));
    }
  }
  out.jsHits = hits;
  return out;
});
console.log("[apilogin2] " + JSON.stringify(r, null, 1).slice(0, 3200));
await lb.close();
