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
import { scopeCookies } from "./cookieScope.js";

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

/** The logged-in fleet org uuid (= partnerUUID), ONLY from the CustomerGatewayUser pattern: a loose uuid would be a wrong org. */
async function captureOrg(page) {
  try {
    return await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const m = html.match(/CustomerGatewayUser:([0-9a-f-]{36})/i);
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
     * @returns {Promise<{ok:boolean, loggedOut?:boolean, cookies?, supplierCookies?, orgUuid?, orgVerified?, tokenExpiries?, error?:string}>}
     */
    async keepWarm(entry, { inject = true, rescue = false } = {}) {
      const { context, page } = entry.handle || {};
      if (!context || !page) return { ok: false, error: "no_context" };

      try {
        // One cookie lineage: start from the newest jar the backend (= the daemon) holds,
        // so the browser never rotates a stale fork. Not in rescue mode: there that jar is
        // the one Uber just refused and must not overwrite the browser's own cookies.
        // CLEARED first: a stored cookie is only {name,value}, so injecting it next to
        // the browser's own `.uber.com` copy would send two values under one name.
        // Clear + inject is exactly the seed path, which is the one proven live.
        if (inject && entry.backendJar) {
          await context.clearCookies();
          await context.addCookies(scopeCookies(entry.backendJar.cookies, entry.backendJar.supplierCookies));
        }
        // A rescue needs ONLY the dispatch (RAMEN) jar back — the offer stream runs on
        // it — so it skips Fleet Hub entirely: the driver waits on ONE page load, not
        // two, which is the whole point of a rescue (every second is lost offers). The
        // supplier jar keeps its stored value. A routine keep-warm still visits Fleet
        // Hub first, where sp-jwt-session (14d) rotates.
        if (!rescue) {
          await page.goto(FLEETHUB_URL, { waitUntil: "domcontentloaded", timeout: config.stepTimeout });
          if (AUTH_RE.test(page.url())) {
            return { ok: true, loggedOut: true };
          }
          await page.waitForTimeout(800);
        }

        // The dispatch host so the RAMEN jar (jwt-session, 24h) stays fresh.
        await page.goto(DISPATCH_URL, { waitUntil: "domcontentloaded", timeout: config.stepTimeout }).catch(() => {});
        if (AUTH_RE.test(page.url())) {
          return { ok: true, loggedOut: true };
        }

        const ramen = (await context.cookies(RAMEN_COOKIE_URL)).map((c) => ({ name: c.name, value: c.value }));
        // A rescue did not refresh Fleet Hub, so it has nothing new to say about the
        // supplier jar — omit it rather than post a stale copy the backend would refuse.
        const supplier = rescue ? undefined : (await context.cookies(FLEETHUB_URL)).map((c) => ({ name: c.name, value: c.value }));
        if (ramen.length === 0) return { ok: false, error: "empty_jar" };

        const orgUuid = await captureOrg(page);

        // Persist storage so a service restart can resume this company without OTP.
        await this.save(entry).catch(() => {});

        return {
          ok: true,
          cookies: ramen,
          supplierCookies: supplier,
          orgUuid,
          orgVerified: !!orgUuid && !!entry.orgUuid && orgUuid.toLowerCase() === String(entry.orgUuid).toLowerCase(),
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
