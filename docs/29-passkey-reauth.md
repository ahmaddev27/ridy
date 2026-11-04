# 29 - Passkey re-auth (software passkey auto-registration)

Status: PR-1 backend shipped DORMANT (all flags OFF). uber-auth side is a separate PR.

## Why
Uber's roughly monthly session death is a hard re-auth that needs a human (see docs/27).
A software passkey registered once on the company's Uber account lets uber-auth sign in
without the human, using a credential Reidey holds.

## Boundary (AGENTS.md rule-#1 amendment)
Registering the passkey is a NEW account write, owner-approved, and only when ALL hold:
global `UBER_PASSKEY_REGISTER`, optional allowlist `UBER_PASSKEY_TENANTS`, and the
company's `settings.passkey.enabled`. Signing in with it additionally needs
`UBER_PASSKEY_LOGIN`. Each registration is audit-logged as `passkey.registered` with the
sha256 of the credential id only. No stored password, no OTP automation.

## Secret handling
`uber_passkeys.credential` is the private key: `encrypted:array` cast, `$hidden`, never in
logs, API responses, audit context or Sentry. The internal API only ever receives it
(POST); there is deliberately no route that reads it back (a Phase-2 read route is gated
for later).

## Contract (uber-auth <-> backend, X-Dispatch-Secret)
- `GET  /api/v1/internal/session-browser/{tenantId}/passkey` -> `{data:{enabled,registered}}`
- `POST /api/v1/internal/session-browser/{tenantId}/passkey` body
  `{credential:{credentialId,privateKey,rpId,userHandle,signCount,isResidentCredential}}`;
  idempotent: an existing active passkey is never overwritten (200, `created:false`).
- backend -> uber-auth `POST /passkey/register {company_key}` (admin button or
  `php artisan uber:register-passkeys --dry-run`).

## Rollout
Enable per company: set `settings.passkey.enabled`, add the id to `UBER_PASSKEY_TENANTS`,
flip `UBER_PASSKEY_REGISTER` (+ `UBER_AUTH_PASSKEY_REGISTER`), then backfill with
`--limit=5 --sleep=60`. Keep `UBER_PASSKEY_LOGIN` OFF until registration is proven.
