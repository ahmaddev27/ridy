// Passkey USE inside the co-browse login (docs/31 "Path A"). The authenticator lives ONLY in the
// co-browse browser the human is logging into; that browser's session becomes the kept one, so
// nothing here can disturb a healthy daemon / persistent session (co-browse only runs on a relink).
// Everything is best-effort: any error is swallowed + logged and the human's login carries on.
//
// OFF unless UBER_AUTH_PASSKEY_REGISTER=1 AND UBER_AUTH_PASSKEY_COBROWSE=1 AND the backend says the
// company is enabled. The stored credential is passed to the browser only and never logged.
import { AUTHENTICATOR } from "./passkey.js";

export const ATTACH = {
  DISABLED: "disabled",
  COMPANY_DISABLED: "company_disabled",
  NO_PAGE: "no_page",
  ATTACHED: "attached",
  INJECTED: "injected",
  FAILED: "failed",
};

/**
 * Attach a virtual authenticator to the co-browse page; inject the company's stored passkey when
 * there is one so Uber's own WebAuthn step auto-signs (the human then skips the code step). With
 * no credential the authenticator still answers "no key" at once instead of a native dialog.
 * @param {{page:object, passkeyAuth?:object}} session  the fullLogin co-browse session
 * @param {string} companyKey
 * @param {{enabled:()=>boolean, flags:(k:string)=>Promise<{enabled?:boolean}|null>, fetchCredential:(k:string)=>Promise<object|null>, log?:(m:string)=>void}} deps
 * @returns {Promise<string>} an ATTACH status; never throws
 */
export async function attachCobrowseAuthenticator(session, companyKey, deps) {
  const { enabled, flags, fetchCredential, log = () => {} } = deps;
  try {
    if (!enabled()) return ATTACH.DISABLED;
    if (!session?.page) return ATTACH.NO_PAGE;
    const f = await flags(companyKey).catch(() => null);
    if (!f?.enabled) return ATTACH.COMPANY_DISABLED;
    const client = await session.page.context().newCDPSession(session.page);
    await client.send("WebAuthn.enable", { enableUI: false });
    const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
    session.passkeyAuth = { client, authenticatorId };
    const credential = await fetchCredential(companyKey).catch(() => null);
    if (!credential) return ATTACH.ATTACHED;
    await client.send("WebAuthn.addCredential", { authenticatorId, credential });
    log(`${companyKey}: stored passkey injected into the co-browse authenticator`);
    return ATTACH.INJECTED;
  } catch (e) {
    log(`${companyKey}: co-browse authenticator failed: ${e?.message}`);
    return ATTACH.FAILED;
  }
}
