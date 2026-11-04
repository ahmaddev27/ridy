// THROWAWAY — full FOR-EACH dry run of the passkey re-auth loop across ALL companies.
// For every state/<tenant>.json it: (1) registers a passkey on the live session (base64url),
// (2) verifies server-side via getPasskeysInfo, (3) exports the PKCS#8 private key, (4) grabs
// the account identifier from getRegistrationOptions.user.name (no human-typed email), then in a
// FRESH logged-out browser (5) injects the passkey and attempts login — NO human, NO co-browse,
// NO cold-login. Prints a per-tenant report. Run INSIDE the uber-auth container; DELETE after.
//
//   git show origin/spike/passkey-api:uber-auth/spike-passkey-all.mjs > ~/spike-passkey-all.mjs
//   docker cp ~/spike-passkey-all.mjs ridy-uber-auth-1:/app/spike-passkey-all.mjs
//   docker exec -e DISPLAY=:99 -w /app ridy-uber-auth-1 node spike-passkey-all.mjs        # all tenants
//   docker exec -e DISPLAY=:99 -w /app ridy-uber-auth-1 node spike-passkey-all.mjs 15     # one tenant
import { chromium } from "playwright";
import { readFile, writeFile, readdir } from "node:fs/promises";

const stateDir = process.env.STATE_DIR || "./state";
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true };

const all = (await readdir(stateDir)).filter((f) => /^\d+\.json$/.test(f)).map((f) => f.replace(".json", ""));
const tenants = process.argv[2] ? [process.argv[2]] : all;
console.log("[all] tenants:", tenants.join(", ") || "(none found in " + stateDir + ")");

const landed = (u) => /supplier\.uber\.com|vsdispatch\.uber\.com|fleethub\.uber\.com|drivers\.uber\.com|account\.uber\.com/i.test(u) && !/auth\.uber\.com/i.test(u);

// ---- the register-finish logic proven to persist (base64url is the key) ----
async function registerPasskey(page) {
  return page.evaluate(async () => {
    const H = { "content-type": "application/json", "x-csrf-token": "x" };
    const b64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const ro = await fetch("/api/getRegistrationOptions", { method: "POST", headers: H, body: "{}" }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
    if (!ro || !ro.data || !ro.data.options) return { ok: false, where: "options", raw: JSON.stringify(ro).slice(0, 200) };
    const o = ro.data.options;
    const alg = (p) => (p.alg && typeof p.alg === "object" ? p.alg.low : p.alg);
    const pk = { rp: o.rp, user: { id: b64u(o.user.id), name: o.user.display_name || "user", displayName: o.user.display_name || "user" }, challenge: b64u(o.challenge), pubKeyCredParams: (o.pub_key_cred_params || []).map((p) => ({ type: p.type, alg: alg(p) })), timeout: 60000, attestation: o.attestation || "none", authenticatorSelection: o.authenticatorSelection || { residentKey: "preferred", userVerification: "preferred" }, excludeCredentials: [] };
    let c;
    try { c = await navigator.credentials.create({ publicKey: pk }); } catch (e) { return { ok: false, where: "create", error: String(e) }; }
    const body = { attestation: { client_data_json: url(c.response.clientDataJSON), attestation_object: url(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : ["internal"] } };
    const fin = await fetch("/api/registerPublicKeyCredential", { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => r.text()).catch((e) => String(e));
    const info = await fetch("/api/getPasskeysInfo", { method: "POST", headers: H, body: "{}" }).then((r) => r.json()).catch(() => ({}));
    const n = (((info || {}).data || {}).publicKeyCredentials || []).length;
    // user.name / display_name is Uber's account identifier (email) — captured to drive login
    return { ok: n > 0, count: n, id: c.id, userName: o.user.name, displayName: o.user.display_name, finish: String(fin).slice(0, 120) };
  });
}

const results = [];
for (const tenant of tenants) {
  const r = { tenant };
  let b1 = null, b2 = null;
  try {
    const state = JSON.parse(await readFile(`${stateDir}/${tenant}.json`, "utf8"));
    // ===== REGISTER + EXPORT KEY + CAPTURE EMAIL =====
    b1 = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
    const ctx = await b1.newContext({ storageState: state, locale: "de-DE" });
    const page = await ctx.newPage();
    const client = await ctx.newCDPSession(page);
    await client.send("WebAuthn.enable", { enableUI: false });
    const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
    await page.goto("https://account.uber.com/passkeys", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    if (page.url().indexOf("auth.uber.com") >= 0) { r.register = "FAIL-auth (session expired)"; await b1.close(); b1 = null; results.push(r); console.log(`[tenant ${tenant}]`, JSON.stringify(r)); continue; }
    const reg = await registerPasskey(page);
    r.register = reg.ok ? "OK" : "FAIL(" + (reg.where || reg.finish || "?") + ")";
    r.email = reg.userName; r.display = reg.displayName; r.passkeys = reg.count;
    let cred = null;
    if (reg.ok) {
      const got = await client.send("WebAuthn.getCredentials", { authenticatorId });
      cred = (got.credentials || [])[0] || null;
      if (cred) { await writeFile(`${stateDir}/passkey-cred-${tenant}.json`, JSON.stringify({ ...cred, userName: reg.userName }, null, 2)); r.hasKey = !!cred.privateKey; }
    }
    await b1.close(); b1 = null;

    // ===== LOGIN (fresh, logged-out, no human) =====
    const identifier = reg.userName || reg.displayName;
    if (cred && cred.privateKey && identifier) {
      b2 = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
      const lctx = await b2.newContext({ locale: "de-DE" });
      const lpage = await lctx.newPage();
      const lclient = await lctx.newCDPSession(lpage);
      await lclient.send("WebAuthn.enable", { enableUI: false });
      const { authenticatorId: aid } = await lclient.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
      await lclient.send("WebAuthn.addCredential", { authenticatorId: aid, credential: cred });
      await lpage.goto("https://auth.uber.com/v2/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      const field = lpage.locator('input[name="identifierTextField"], input[type="email"], input[autocomplete="username"], input[inputmode="email"], form input').first();
      await field.click({ timeout: 15000 }).catch(() => {});
      await field.pressSequentially(identifier, { delay: 40 }).catch(() => {});
      await lpage.keyboard.press("Enter").catch(() => {});
      await lpage.waitForTimeout(4500);
      r.afterEmail = { url: lpage.url(), buttons: await lpage.getByRole("button").allInnerTexts().catch(() => []), body: (await lpage.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 320) };
      for (const re of [/passkey|sicherheitsschl|mit einem schl/i, /weitere option|andere option|more option/i, /passkey/i, /^weiter$|^continue$|anmelden/i]) {
        const btn = lpage.getByRole("button", { name: re }).first();
        if (await btn.count().catch(() => 0)) { await btn.click({ timeout: 4000 }).catch(() => {}); await lpage.waitForTimeout(2500); }
      }
      await lpage.waitForTimeout(3000);
      r.login = landed(lpage.url()) ? "✅ LANDED " + lpage.url() : "⚠️ stuck " + lpage.url();
      await b2.close(); b2 = null;
    }
  } catch (e) {
    r.error = e.message;
  } finally {
    try { if (b1) await b1.close(); } catch {}
    try { if (b2) await b2.close(); } catch {}
  }
  results.push(r);
  console.log(`[tenant ${tenant}]`, JSON.stringify(r).slice(0, 700));
}
console.log("\n[ALL RESULTS]\n" + JSON.stringify(results, null, 1).slice(0, 4500));
