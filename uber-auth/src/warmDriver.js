// The Playwright side of the persistent session manager: the `driver` the
// PersistentSessionManager calls to keep one company's live browser warm.
//
// keepWarm(entry): visit the authenticated fleet pages so Uber rotates/reissues
//   the SIGNED tokens (jwt-session on vsdispatch, sp-jwt-session on fleethub) that
//   the dispatch daemon cannot refresh, then capture BOTH host-scoped cookie jars
//   (exactly as the extension does) and the token expiries. If a visit redirects
//   to the Uber sign-in, the browser has been signed out (a hard re-auth) → report
//   loggedOut so the manager flips the company to needs_otp. It also saves the
//   context's storage to disk so a service restart can resume without a new OTP.
//
// This file is the one part of the subsystem that cannot be unit-tested without a
// real logged-in Uber account; it must be validated live on one consenting company
// before any rollout (see docs/23).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "./config.js";

const AUTH_RE = /auth\.uber|\/(auth|login|oauth)/i;
const FLEETHUB_URL = "https://fleethub.uber.com/";
const DISPATCH_URL = "https://vsdispatch.uber.com/";
// Match the extension's per-URL capture so the daemon gets the exact cookie set
// the browser would send to each host (getAll by domain returns conflicting values).
const RAMEN_COOKIE_URL = "https://vsdispatch.uber.com/ramendca/events";

/** The `exp` claim of a signed JWT cookie, in ms epoch, or null. Never verifies. */
function jwtExpiryMs(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json);
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function cookieValue(list, name) {
  const c = list.find((x) => x.name === name);
  return c ? c.value : null;
}

function statePath(companyKey) {
  return join(config.stateDir, `${String(companyKey).replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

/** The logged-in fleet org uuid (= partnerUUID), read from the page like browser.js. */
async function captureOrg(page) {
  try {
    return await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const m = html.match(/CustomerGatewayUser:([0-9a-f-]{36})/i) || html.match(/"uuid":"([0-9a-f-]{36})"/i);
      return m ? m[1] : null;
    });
  } catch {
    return null;
  }
}

export function createWarmDriver() {
  return {
    /**
     * @param {{companyKey:string, handle:{browser:any, context:any, page:any}}} entry
     * @returns {Promise<{ok:boolean, loggedOut?:boolean, cookies?, supplierCookies?, orgUuid?, tokenExpiries?, error?:string}>}
     */
    async keepWarm(entry) {
      const { context, page } = entry.handle || {};
      if (!context || !page) return { ok: false, error: "no_context" };

      try {
        // Fleet Hub first: this is where sp-jwt-session (14d) rotates.
        await page.goto(FLEETHUB_URL, { waitUntil: "domcontentloaded", timeout: config.stepTimeout });
        if (AUTH_RE.test(page.url())) return { ok: true, loggedOut: true };
        await page.waitForTimeout(800);

        // Then the dispatch host so the RAMEN jar (jwt-session, 24h) stays fresh too.
        await page.goto(DISPATCH_URL, { waitUntil: "domcontentloaded", timeout: config.stepTimeout }).catch(() => {});
        if (AUTH_RE.test(page.url())) return { ok: true, loggedOut: true };

        const ramen = (await context.cookies(RAMEN_COOKIE_URL)).map((c) => ({ name: c.name, value: c.value }));
        const supplier = (await context.cookies(FLEETHUB_URL)).map((c) => ({ name: c.name, value: c.value }));
        if (ramen.length === 0) return { ok: false, error: "empty_jar" };

        const orgUuid = await captureOrg(page);

        // Persist storage so a service restart can resume this company without OTP.
        await this.save(entry).catch(() => {});

        return {
          ok: true,
          cookies: ramen,
          supplierCookies: supplier,
          orgUuid,
          tokenExpiries: {
            ramen: jwtExpiryMs(cookieValue(ramen, "jwt-session")),
            supplier: jwtExpiryMs(cookieValue(supplier, "sp-jwt-session")),
          },
        };
      } catch (e) {
        return { ok: false, error: e?.message || "keepwarm_error" };
      }
    },

    /** Write the context's cookies/localStorage to disk for restart-resume. */
    async save(entry) {
      const path = statePath(entry.companyKey);
      await mkdir(dirname(path), { recursive: true });
      const state = await entry.handle.context.storageState();
      await writeFile(path, JSON.stringify(state), "utf8");
    },

    async close(entry) {
      await entry.handle?.browser?.close?.().catch(() => {});
    },
  };
}

export { statePath, jwtExpiryMs };
