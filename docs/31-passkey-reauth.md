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
- Runs on a NEW PAGE of the company's HELD session context (the persistent session browser,
  which `adoptLogin()` fills after a connect / co-browse). No second browser, no cookie copy:
  Uber sees the one device it already knows. The company's keep-warm is parked meanwhile
  (`PersistentSessionManager.withBusy`; `renew()` skips a busy or already-renewing entry).
- Idempotent twice: the backend says `registered` => skip; otherwise `getPasskeysInfo` first and
  any existing passkey => `uber_has_passkey`, skip (never piled up).
- After every attempt one normal keep-warm runs; if the session is no longer `active` the result
  is `session_lost`, `console.error [passkey][ALERT]` fires, the backend records the failure
  (`Log::critical` + audit `passkey.failed`) and `uber:passkey-backfill` halts the run.
- If Uber accepted the passkey but the backend would not store the key (3 tries): `store_failed`,
  loud alert; the orphan passkey must be removed on account.uber.com/passkeys by a human.
- The daemon is never stopped/relinked. Cookie rotation from the visit goes through the normal
  capture path (the daemon resumes seq across teardowns).
- Caveat: a context SEEDED from stored cookies only carries the vsdispatch/fleethub jars; if
  account.uber.com does not accept it the result is `not_authenticated` (nothing changed). The
  after-connect hook (login/co-browse contexts) is the primary path.

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
