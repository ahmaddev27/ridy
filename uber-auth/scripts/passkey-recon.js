// Phase 0 recon (READ-ONLY) for the server-held-passkey feasibility pilot.
//
// For ONE pilot tenant it seeds a browser from the session the extension already
// captured (exactly like persistent.js seedFromSession) and then, WITHOUT writing
// anything to Uber, answers the two cheapest pilot questions:
//   1. Does the seeded SERVER session actually reach account.uber.com authenticated?
//      (i.e. can our server session even talk to the passkey API — the precondition
//      for registering a passkey there later.)
//   2. What passkeys already exist on the account? Read straight from Uber's own
//      getPasskeysInfo (NOT Arkose-gated — only the DELETE is), with each device
//      name classified the same way the extension purge classifies them, so the
//      report flags exactly what that purge would delete — including, critically, a
//      server/headless-named key we might later register ourselves.
//
// It REGISTERS nothing and DELETES nothing. Output: a JSON report + a full-page
// screenshot in the state dir, plus a console summary.
//
// Run on the box/container that runs uber-auth (same env: RIDY_API_URL +
// DISPATCH_INGEST_SECRET):
//   node scripts/passkey-recon.js <tenantId>
// tenantId defaults to the first ONLY_TENANTS entry.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../src/config.js";
import { launchBrowser, newStealthContext } from "../src/browser.js";

const PASSKEYS_URL = "https://account.uber.com/passkeys";
const AUTH_RE = /auth\.uber|\/(auth|login|oauth)/i;

// The exact classifiers the extension purge uses (extension/content.js) — so this
// report flags precisely what that purge targets. A server passkey we register will
// likely read as "competitor/server" here, which is the self-collision to design
// around before any rollout.
const COMPETITOR_PASSKEY =
  /(linux|ubuntu|debian|fedora|cent\s*os|red\s*hat|\barch\b|headless|\bserver\b|\bvps\b|\bcloud\b|puppeteer|playwright|selenium|python|node\.?js|\bbot\b|chromium)/i;
const PERSONAL_PASSKEY =
  /(samsung|galaxy|iphone|ipad|\bios\b|android|pixel|windows|macbook|\bmac\b|macos|\bedge\b|safari)/i;

function classify(name) {
  const n = name || "";
  if (COMPETITOR_PASSKEY.test(n) && !PERSONAL_PASSKEY.test(n)) return "competitor/server";
  if (PERSONAL_PASSKEY.test(n)) return "personal-device";
  return "unknown";
}

async function fetchWanted() {
  const res = await fetch(`${config.apiBaseUrl}/api/v1/internal/session-browser/wanted`, {
    headers: { Accept: "application/json", "X-Dispatch-Secret": config.dispatchSecret },
  });
  if (!res.ok) throw new Error(`wanted -> ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body?.data) ? body.data : [];
}

// Each stored cookie is just {name,value}; re-attach it to every host we need to
// talk to. Playwright infers domain/path/secure from the url.
function toPlaywrightCookies(list, url) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.name === "string" && typeof c.value === "string")
    .map((c) => ({ name: c.name, value: c.value, url }));
}

// Uber's authoritative passkey list for the current page origin. Read-only. We keep
// the whole passkeyInfo object, not just the name, so the report captures anything
// Uber exposes (created date, aaguid, credential id…).
async function readPasskeys(page) {
  return page.evaluate(async () => {
    try {
      const res = await fetch("https://account.uber.com/api/getPasskeysInfo?localeCode=en", {
        method: "POST",
        credentials: "include",
        headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
        body: "{}",
      });
      return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
    } catch (e) {
      return { ok: false, status: 0, error: String(e) };
    }
  });
}

async function main() {
  const tenantId = String(process.argv[2] || config.onlyTenants[0] || "").trim();
  if (!tenantId) throw new Error("usage: node scripts/passkey-recon.js <tenantId>");

  const wanted = await fetchWanted();
  const session = wanted.find((s) => String(s.tenant_id) === tenantId);
  if (!session) throw new Error(`tenant ${tenantId} not in the wanted list (is it active + connected?)`);

  const browser = await launchBrowser();
  const report = { tenant_id: tenantId, at: new Date().toISOString() };
  try {
    const context = await newStealthContext(browser);
    await context.addCookies([
      ...toPlaywrightCookies(session.cookies, "https://vsdispatch.uber.com/"),
      ...toPlaywrightCookies(session.supplier_cookies, "https://fleethub.uber.com/"),
      // The passkey API lives on account.uber.com — carry the same session cookies
      // there so the SSO identity (sid/csid on .uber.com) reaches it too.
      ...toPlaywrightCookies(session.cookies, "https://account.uber.com/"),
      ...toPlaywrightCookies(session.supplier_cookies, "https://account.uber.com/"),
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(config.stepTimeout);

    await page
      .goto(PASSKEYS_URL, { waitUntil: "domcontentloaded", timeout: config.stepTimeout })
      .catch(() => {});
    await page.waitForTimeout(1500);
    report.landing_url = page.url();
    report.authenticated = !AUTH_RE.test(page.url());

    await mkdir(config.stateDir, { recursive: true });
    const shot = join(config.stateDir, `recon-${tenantId}-passkeys.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    report.screenshot = shot;

    const pk = await readPasskeys(page);
    report.passkeys_api = { ok: pk.ok, status: pk.status, error: pk.error };
    const list = pk?.body?.data?.publicKeyCredentials;
    if (Array.isArray(list)) {
      report.passkeys = list.map((c) => {
        const name = (c?.passkeyInfo?.name || "").trim();
        return { name, kind: classify(name), info: c?.passkeyInfo ?? null };
      });
      report.passkey_count = list.length;
      report.has_competitor_name = report.passkeys.some((p) => p.kind === "competitor/server");
    } else {
      report.passkeys = [];
      report.passkey_count = 0;
      report.note =
        "getPasskeysInfo returned no publicKeyCredentials — either not authenticated on account.uber.com, or the response format changed";
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const out = join(config.stateDir, `recon-${tenantId}.json`);
  await writeFile(out, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n=== passkey recon: tenant ${tenantId} ===`);
  console.log(`authenticated on account.uber.com : ${report.authenticated}`);
  console.log(`passkeys found                    : ${report.passkey_count}`);
  for (const p of report.passkeys || []) console.log(`  - "${p.name}" [${p.kind}]`);
  if (report.note) console.log(`note: ${report.note}`);
  console.log(`report     : ${out}`);
  console.log(`screenshot : ${report.screenshot}`);
}

main().catch((e) => {
  console.error(`recon failed: ${e?.message || e}`);
  process.exit(1);
});
