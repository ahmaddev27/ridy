// THROWAWAY — discovery for Path B. Our own fetch to /rt/webauthn-api/get-auth-options got HTML
// (rejected: wrong headers/CSRF), while the page's own call returns JSON. So: (1) capture the
// REAL request headers + body of the page's get-auth-options call (to replicate it), and
// (2) enumerate every /rt/webauthn-api/* endpoint referenced in Uber's auth JS (to find the
// FINISH/verify endpoint the UI never calls). No login attempt — pure discovery.
//
//   git show origin/spike/passkey-api:uber-auth/spike-passkey-discover.mjs > ~/spike-passkey-discover.mjs
//   docker cp ~/spike-passkey-discover.mjs ridy-uber-auth-1:/app/spike-passkey-discover.mjs
//   docker exec -w /app ridy-uber-auth-1 xvfb-run -a node spike-passkey-discover.mjs
import { chromium } from "playwright";

const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };
const b = await chromium.launch({ headless: false, channel: "chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ locale: "de-DE" });
const page = await ctx.newPage();
const client = await ctx.newCDPSession(page);
await client.send("WebAuthn.enable", { enableUI: false });
await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });

// Capture the REAL request (headers + body) of any /rt/webauthn-api/ call the page makes.
page.on("request", (rq) => {
  const u = rq.url();
  if (/webauthn-api|\/rt\//i.test(u)) {
    const h = rq.headers();
    const redacted = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, /cookie|authorization/i.test(k) ? "<redacted>" : v]));
    console.log("[REQ] " + rq.method() + " " + u.replace(/https:\/\/[^/]+/, ""));
    console.log("[REQ-HEADERS] " + JSON.stringify(redacted));
    const pd = rq.postData(); if (pd) console.log("[REQ-BODY] " + pd.slice(0, 300));
  }
});

await page.goto("https://auth.uber.com/v2/", { waitUntil: "networkidle", timeout: 40000 }).catch((e) => console.log("nav:", e.message));
await page.waitForTimeout(3500); // let conditional-UI fire get-auth-options

// Enumerate every /rt/webauthn-api/* (and nearby webauthn) endpoint literal in the loaded JS.
const found = await page.evaluate(async () => {
  const srcs = Array.from(document.querySelectorAll("script[src]")).map((s) => s.src);
  const eps = new Set();
  const ctxs = [];
  for (const src of srcs) {
    let txt = "";
    try { txt = await fetch(src).then((r) => r.text()); } catch { continue; }
    for (const m of txt.matchAll(/["'`](\/rt\/webauthn-api\/[a-z0-9-]+|\/rt\/[a-z0-9/-]*webauthn[a-z0-9/-]*)["'`]/gi)) eps.add(m[1]);
    for (const m of txt.matchAll(/webauthn-api\/[a-z0-9-]+/gi)) eps.add(m[0]);
    // a little context around the first get-auth-options reference, to see sibling endpoints
    const i = txt.indexOf("get-auth-options");
    if (i >= 0 && ctxs.length < 3) ctxs.push(txt.slice(Math.max(0, i - 120), i + 200).replace(/\s+/g, " "));
  }
  return { scripts: srcs.length, endpoints: Array.from(eps), ctxs };
});
console.log("[DISCOVER] " + JSON.stringify(found, null, 1).slice(0, 2600));
await b.close();
