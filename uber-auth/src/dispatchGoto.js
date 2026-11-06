import { config } from "./config.js";

export function isRedirectLoop(e) {
  return /ERR_TOO_MANY_REDIRECTS/i.test(e?.message || "");
}

/**
 * Open the dispatch dashboard. A dead vsdispatch jwt-session left in a reused context
 * redirect-loops against auth. On a loop: drop ONLY the dispatch host's cookies (the
 * auth/account cookies, which the passkey sign-in needs, stay) and retry once.
 * Returns false when it still loops; other errors propagate.
 */
export async function gotoDispatch(page, context) {
  const go = () => page.goto(config.dashboardUrl, { waitUntil: "domcontentloaded" });
  try {
    await go();
    return true;
  } catch (e) {
    if (!isRedirectLoop(e)) throw e;
  }
  try {
    await context.clearCookies({ domain: new URL(config.dashboardUrl).hostname });
    console.warn("login: dispatch redirect loop, cleared dispatch-host cookies and retrying");
    await go();
    return true;
  } catch (e) {
    if (!isRedirectLoop(e)) throw e;
    console.warn("login: dispatch redirect loop persists after clearing dispatch cookies");
    return false;
  }
}
