# 29 - Passkey registration (software passkey on the company's Uber account)

Status: code shipped DORMANT (every flag OFF, nothing runs on boot / cron / deploy). Validation
on ONE tenant is a human-triggered step. Login with the passkey is NOT built (later task).

## Why
Uber's roughly monthly session death is a hard re-auth that needs a human (docs/27). A software
passkey registered once on the account is the groundwork for a human-free re-login later. This
doc covers only REGISTRATION + encrypted storage + the gated triggers.

## Boundary (AGENTS.md rule-#1 amendment)
A second, owner-approved account WRITE. Allowed only when ALL hold:
- backend `UBER_PASSKEY_REGISTER` (+ optional allowlist `UBER_PASSKEY_TENANTS`),
- the company's `tenants.settings.passkey.enabled = true` (set via tinker; no UI),
- uber-auth `UBER_AUTH_PASSKEY_REGISTER=1`.
`UBER_AUTH_PASSKEY_ON_CONNECT=1` additionally enables the after-connect hook.

## Safety design
- **Separate, short-lived browser; the live session is never touched.** LIVE-TEST FINDING
  (tenant 15): registering INSIDE the held persistent-session browser context made Uber sign
  that live session out (needs_otp / hard re-auth). In-session registration is UNSAFE and was
  removed. Now `passkey.js` launches its OWN ephemeral Chrome seeded (`storageState`) from a
  read-only COPY of `state/<companyKey>.json`, registers via the CDP virtual authenticator,
  verifies with `getPasskeysInfo`, exports the PKCS#8 credential and closes the browser. This
  is the recipe the spikes (spike/passkey-api) used 7 times on tenant 15 without a sign-out.
  The persistent browser, its context, the keep-warm and the daemon / RAMEN stream are not
  parked, adopted, mutated or restarted.
- **All traffic through the company's own residential proxy.** The ephemeral browser gets
  Playwright's `proxy` from the tenant's `proxy_url` (read from the backend `wanted` list, the
  same value the daemon / held browser use), via `newStealthContext`. A direct datacenter-IP
  visit to account.uber.com reads as a new device/location and can sign the session out, so a
  company with no (parsable) proxy returns `no_proxy` before anything is read or launched.
  Missing/unreadable state file => `not_authenticated`, nothing launched.
- Idempotent twice: the backend says `registered` => skip; otherwise `getPasskeysInfo` first and
  any existing passkey => `uber_has_passkey`, skip (never piled up).
- After every attempt one normal keep-warm runs on the LIVE session (it should stay active; this
  only verifies); if the session is no longer `active` the result
  is `session_lost`, `console.error [passkey][ALERT]` fires, the backend records the failure
  (`Log::critical` + audit `passkey.failed`) and `uber:passkey-backfill` halts the run.
- If Uber accepted the passkey but the backend would not store the key (3 tries): `store_failed`,
  loud alert; the orphan passkey must be removed on account.uber.com/passkeys by a human.
- The daemon is never stopped/relinked. Cookie rotation from the visit goes through the normal
  capture path (the daemon resumes seq across teardowns).
- Caveat: the state copy must carry account.uber.com cookies; if Uber does not accept it the
  result is `not_authenticated` (nothing changed). The after-connect hook and the backfill
  command both use this same isolated path.

## Mechanism (proven in spike/passkey-api)
CDP `WebAuthn.addVirtualAuthenticator` (ctap2/internal/resident/UV/autoPresence) on
account.uber.com/passkeys -> `POST /api/getRegistrationOptions` (`x-csrf-token: x`) ->
`navigator.credentials.create()` -> `POST /api/registerPublicKeyCredential`
`{attestation:{client_data_json, attestation_object, transports}}` with **base64url** binaries
(standard base64 is rejected as BAD_REQUEST) -> verify `getPasskeysInfo` count grew -> export
the credential (PKCS#8 private key) via `WebAuthn.getCredentials`. Code: `uber-auth/src/passkey.js`.

## Data + secrets
`uber_passkeys` (one row per tenant): `credential` = `encrypted:array` cast (credentialId,
privateKey, rpId, userHandle, signCount, account email), `$hidden`; `credential_id_hash`
(sha256) is how we recognise ours. A failed attempt leaves a row with `credential = NULL`,
`status = failed`; an active row is never downgraded or overwritten. The internal API only
RECEIVES the credential, and releases it ONLY through the one injection accessor below.

## Contract (uber-auth <-> backend, X-Dispatch-Secret)
- `GET  /api/v1/internal/session-browser/{tenant}/passkey` -> `{data:{enabled,registered}}`
- `POST .../{tenant}/passkey` `{credential:{...}, uber_org_uuid?}` (403 unless enabled; idempotent)
- `POST .../{tenant}/passkey/failure` `{reason}`
- `GET  .../{tenant}/passkey/credential` -> `{data:{credentialId,isResidentCredential,rpId,privateKey,userHandle,signCount}}`
  = the decrypted credential in the exact shape CDP `WebAuthn.addCredential` takes (404 unless
  both backend flags are on and an ACTIVE passkey exists; `no-store`). Backend accessor:
  `PasskeyService::credentialForInjection(Tenant)`. uber-auth accessor:
  `fetchPasskeyCredential(companyKey)` in `persistent.js` (also needs UBER_AUTH_PASSKEY_REGISTER).
  This is the hook for the co-browse injection task; never log or persist what it returns.
- backend -> uber-auth `POST /passkey/register {company_key}` -> `{status}` only.

## Triggers (neither is automatic)
1. After-connect hook (`server.js onLoginSuccess`): needs REGISTER + ON_CONNECT envs; fires 20 s
   after a successful connect / co-browse, in the background.
2. `php artisan uber:passkey-backfill`: dry-run unless `--run`; `--tenant=ID` = exactly that
   company; no `--tenant` needs `--confirm` (+ `--limit`, `--sleep`); halts on `session_lost`.

## Validation plan (one tenant, human-run)
1. Set the three flags + the company flag for ONE tenant. 2. `uber:passkey-backfill --tenant=ID`
(dry run), then `--run`. 3. Check result status, `uber_passkeys` row, session still active,
daemon streaming. 4. Only then widen.

## Path A: passkey inside the co-browse login (UBER_AUTH_PASSKEY_COBROWSE)
Why it is safe: a live test showed that adding a passkey from a SEPARATE browser makes Uber sign
out the account's OTHER sessions (it killed the persistent/daemon session). The device that ADDS
the passkey is the one Uber keeps. Co-browse only runs during a relink / first connect, and the
browser the human logs into becomes the new live session. So doing the passkey work inside that
very browser is the "add from the kept session" case, with no healthy session to disturb. Nothing
here calls a daemon stop/relink, opens a second browser, or touches the held persistent browser.

Flags (all default OFF): `UBER_AUTH_PASSKEY_REGISTER` AND `UBER_AUTH_PASSKEY_COBROWSE` in uber-auth,
plus the backend flags and `tenants.settings.passkey.enabled`. Everything is best-effort: an error is
logged and swallowed and never fails the human's login. Only fullLogin (human_login) co-browse.

1. USE (before the human types): `server.js` `/login/start`, right after `startLogin` parks a
   fullLogin session, calls `attachCobrowsePasskey` (`cobrowsePasskey.js`): CDP `WebAuthn.enable` +
   `addVirtualAuthenticator` (ctap2/internal/resident/UV/auto presence) on the co-browse page's
   context. If the company has a stored passkey (`fetchPasskeyCredential`), `addCredential` puts it
   in, so Uber's own WebAuthn step auto-signs and the human skips the code step. Email and
   Arkose/captcha stay with the human. If Uber offers no passkey, the normal OTP path continues.
   Bounded to 5 s so it can never stall the start.
2. REGISTER (only after the login LANDED): `onLoginSuccess`, after the capture was accepted, runs
   `registerPasskeyInCobrowse` (8 s later, background): `passkey.js registerPasskeyInSession` opens
   one short-lived tab on the adopted co-browse context, runs the proven base64url register against
   account.uber.com, stores the key encrypted via the backend, closes the tab. Skipped if the backend
   or Uber already has a passkey, or the manager does not hold the company as `active`. Never before
   the landing, never from another browser. With Path A on, the legacy separate-browser
   after-connect trigger is NOT used for co-browse logins.
3. Known follow-up: the injected credential's `signCount` is not written back after use.

Golden rule #1: the register is the owner-approved WRITE exception; the injection only answers
Uber's own verification prompt and never acts for the driver on an offer.
