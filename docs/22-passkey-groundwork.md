# 22 — Passkeys (WebAuthn) groundwork — research & options only

> **Status: research document. Nothing in it is implemented, deployed, or decided.**
> Branch `research/passkey-groundwork`, measured against `main` @ `6c50292` on 2026-10-27.
> No dependency was added, no migration was written, no server was touched. Every
> fact below is either **MEASURED** (file:line in this repo at that commit, or a
> primary source URL) or explicitly listed in §9 as **unverified**. All decisions
> go back to the owner (§10).

## 0. Scope — two features that share a name

El-Professor runs on GoTrue/Supabase, which ships passkey support as configuration;
no WebAuthn code gets written there. Reidey has no equivalent: Sanctum has no passkey
support, so everything here is new surface. These are **two independent features with
the same name**, and this document covers only Reidey's half.

The questions this document answers:

1. Which server library, on measured grounds — and what was rejected (§2).
2. Where it mounts on the dashboard (cookie session, guard `web`) and what happens
   to `session()->regenerate()` and remember-me (§3).
3. Whether the **driver app** — the case that matters — can do this at all (§4).
4. What breaks: the El-Professor `elprofessor:read` token and `EnsureDashboardToken` (§5).
5. Enrollment & recovery: lost phone, last passkey deleted, which accounts have no
   way back (§6).

Boundaries honored throughout: no push to `main` (a push there is a zero-touch
production release running `migrate --force`), no file in `database/migrations/`
(schema is described in prose only, §7), no change to `composer.json` /
`package.json` (proposals with versions only, §2/§4), no contact with the
production server (everything needing it is named in §9, not guessed).

---

## 1. Current auth state (measured @ 6c50292)

Two identity models, two guards — this shapes everything below:

| | Dashboard operators | Drivers |
| --- | --- | --- |
| Model / table | `App\Models\User` / `users` | `App\Domain\Fleet\Models\Driver` / `drivers` |
| Guard | `web` = session + `users` provider (`config/auth.php:43-44`) | `driver` = `sanctum-bearer` (custom `App\Domain\Auth\BearerTokenGuard`) + `drivers` provider (`config/auth.php:52-53`) |
| Credential | password, hand-rolled check (`PasswordCheck::matches`, `AuthController.php:26`) — **not** `Auth::attempt` (0 hits in `backend/app`) | 6-digit email OTP → `createToken('driver-app')` with default `['*']` abilities (`DriverAuthController.php:307`) |
| `password` column | **NOT nullable** (`0001_01_01_000000_create_users_table.php:19`) | nullable (`2026_08_15_112842_add_auth_to_drivers_table.php:19`) |
| Transport | Sanctum SPA **stateful cookies** (`bootstrap/app.php:35` `statefulApi()`; frontend sends `credentials: "include"` + `X-XSRF-TOKEN`, zero `Authorization` headers in `frontend/src`) | Bearer token stored in the app (`expo-secure-store` is in `driver-app/package.json`) |

Facts the plan leans on:

- **Dashboard login** (`AuthController::login`, route `routes/api.php:90` behind
  `throttle:credentials`): password check → suspended-tenant gate → `if ($request->hasSession()) {
  Auth::guard('web')->login($user, $request->boolean('remember')); $request->session()->regenerate(); }`
  (`AuthController.php:53-56`). Logout invalidates + regenerates the CSRF token
  (`AuthController.php:76-85`). No 2FA of any kind exists (0 hits for
  totp/2fa/mfa/recovery_codes in backend app code).
- **No auth scaffolding package.** No Fortify/Breeze/Jetstream/Passport
  (`backend/composer.json:8-19`); auth is hand-rolled on Sanctum 4.3.2 +
  spatie/laravel-permission (versions from `composer.lock`). The stock password
  broker config (`auth.php:116-121`) is dead — operator reset is a hand-rolled
  email-OTP flow (`PasswordResetController.php`).
- **Driver OTP today** — what a passkey would replace: 6 digits, `random_int`,
  stored **plaintext** in `password_resets.otp` keyed by unique email
  (`2026_08_11_000002_create_password_resets_table.php:19-22`), TTL 10 min
  (`DriverAuthController.php:31`), `hash_equals` compare + attempt caps
  (`OtpGuard.php:133`, caps at `:43-55`), single-use consume before token mint
  (`DriverAuthController.php:105`). It **travels by email** — that is the security
  delta a device-bound passkey buys. The `password_resets` row is shared by three
  flows (driver login `DriverAuthController.php:57`, driver legacy reset
  `DriverPasswordResetController.php:34`, operator reset `PasswordResetController.php:33`),
  so a new request in one overwrites the pending code of the others.
- **Sanctum session hygiene:** `AuthenticateSession` is active for stateful requests
  (`config/sanctum.php:95`): it stores `password_hash_web` in the session and logs
  out every session of a user whose password hash changes. With passkeys **additive**
  (operators keep passwords) this is untouched; a hypothetical passwordless-operator
  future collides with it and with the NOT-NULL password column — both named in §9.
- **Session config:** database driver, prod lifetime default **525600 min (~1 year)**
  (`docker-compose.prod.yml:47`), `same_site=lax`, secure cookies in prod.
- **Rate limiting** is per-route named limiters (`AuthRateLimits.php`); there is no
  global API throttle (`throttleApi()` never called). New passkey endpoints need
  their own named limiters in the same pattern.
- **Prior art: none.** 0 hits for webauthn/passkey/fido/PublicKeyCredential across
  `backend/`, `frontend/src`, `driver-app/`, `docs/` (the only "passkey" strings are
  about **Uber account** passkeys in the extension, and one unused dashboard i18n key).

---

## 2. Library choice (measured comparison)

The question was `laragear/webauthn` vs `web-auth/webauthn-lib`. Measurement
reframed it. Four findings first (all primary-source, fetched 2026-10-27; the
decisive ones re-verified by hand against the pinned upstream sources):

1. **`laragear/webauthn` is end-of-life.** v5.0.2 (2026-05-08) is its last release;
   the GitHub repo is archived with issues/PRs disabled; Packagist flags every
   version `"abandoned": "laravel/passkeys"`; its own README opens with "This
   package is no longer maintained due to an official implementation."
2. **A first-party package exists: `laravel/passkeys`** v0.2.1 (2026-05-18, repo
   `laravel/passkeys-server`), built **on** `web-auth/webauthn-lib 5.3.x`. Fortify
   ≥ 1.37.0 integrates it and the Laravel 13 Fortify docs document it — so "does
   first-party support exist?" is **yes**, which changes the build-vs-wait frame.
3. **`android:apk-key-hash:` origins pass `web-auth/webauthn-lib` only from 5.3.3**
   (2026-05-17). Verified in source: `CheckAllowedOrigins` sorts allowlist entries
   with a scheme but no host into a `rawOrigins` bucket matched **verbatim**
   (`in_array($C->origin, $this->rawOrigins, true)`); 5.3.0–5.3.2 instead rewrote
   such entries to `https://android:…`, which never matches, and without
   `setAllowedOrigins()` the legacy `CheckOrigin` step rejects any non-https origin.
   The maintainer fixed the regression 11 days after the report (issue #888 →
   PR #894, four dedicated tests). **Reidey's floor is therefore ≥ 5.3.3.**
4. **Nothing Laravel-side is stateless by default.** Laragear stores the ceremony
   challenge in the session (pluggable via its `WebAuthnChallengeRepository`
   contract, but the cache approach leans on internal pipe order its README calls
   unstable); `laravel/passkeys` hard-codes the session into its controllers and
   requests (its inner Actions are session-free); `webauthn-lib` leaves challenge
   persistence entirely to the caller — which is exactly what the cookie-less
   driver app needs (§4.6).

| | `laragear/webauthn` v5.0.2 | `web-auth/webauthn-lib` 5.3.9 | `laravel/passkeys` v0.2.1 |
| --- | --- | --- | --- |
| State | **archived / abandoned** (last release 2026-05-08) | **active**: 15 releases in 18 months, last 2026-09-10, responsive (median issue-close 1.8 days) | 0.x: 3 tags in 6 months, only CI/dependabot commits since 05-2026 |
| Laravel 13 + PHP 8.4 | yes (`illuminate/* 12.*\|13.*`, `php ^8.3`; CI matrix includes 8.4×L13) | yes (`php >=8.2`, Symfony `^6.4\|^7\|^8`; no illuminate dep) | yes (CI 8.2–8.5 × L11–13) |
| Footprint vs `composer.lock` | +2 packages | +16 packages (cbor/pki/cose + 4 symfony components) — **no constraint conflicts**; Symfony 8.1 already pinned, PHP floor 8.4.1 unchanged. Resolver dry-run not run (§9) | +17 (the 16 + itself) |
| Ships | polymorphic migration, config, route registrar, FormRequests, controller stubs | **ceremonies only** — routes, migration, persistence, challenge store are ours | migration (**single-model FK**), routes under `web` middleware, controllers |
| Guard binding | `eloquent-webauthn` provider + model trait; `login()` does `attempt()` + `session()->regenerate()`, remember via field/header; README refuses Sanctum support "with extreme prejudice" | none — after `check()` we call `Auth::guard('web')->login()` or `createToken()` ourselves, any guard | requires a `StatefulGuard` (throws otherwise); `login($user, $remember)` + regenerate |
| `android:apk-key-hash` origin | **yes** — exact-string entries in `WEBAUTHN_ORIGINS`, README-documented (non-URL branch confirmed by a `parse_url` probe) | **yes ≥ 5.3.3** via `setAllowedOrigins()` (verified in source + upstream tests) | forwards `allowed_origins` unfiltered to the engine → works, but native origins are documented nowhere in it or Fortify |
| Challenge storage | session default; replaceable contract | **caller-owned** — verify takes the original options object; store is our design (§4.6) | session hard-coded in the HTTP layer; Actions reusable |
| Two models (User + Driver) | **yes** — `authenticatable` morphs | n/a — our schema (§7) | **no** — `foreignIdFor(Passkeys::userModel(), 'user_id')`, one global user model |
| Security record | 0 advisories listed, but hand-written CBOR/COSE with no independent audit found | 3 historical advisories, none affecting 5.3.9 (incl. CVE-2026-30964, the 5.2.0–5.2.3 origin-collapse bug — fixed) | 0 advisories; open issue #41 (iOS-Safari user-handle corruption → login failure); pins engine to `5.3.x` |

**Rejected, and why (measured):**

- **`laragear/webauthn`** — abandoned upstream is disqualifying for a brand-new
  security surface, despite having the best native-origin documentation and the only
  shipped polymorphic schema (its schema shape is reused as the reference in §7).
- **`asbiin/laravel-webauthn` 6.0.0** — its `setAllowedOrigins()` call is
  **commented out** in the service provider, so Android origins are rejected out of
  the box (open issue #524 reports exactly this); Symfony 8 support is an open PR;
  ships jQuery/Bootstrap views; single-model FK.
- **`web-auth/webauthn-symfony-bundle`** — full-stack Symfony, not Laravel.
- **Adopting Fortify to get first-party passkeys** — Reidey's auth is deliberately
  hand-rolled (§1: no Fortify/Breeze, custom OTP, custom guards); bolting Fortify on
  is a re-architecture, and `laravel/passkeys` underneath still couldn't serve the
  driver model or a stateless flow today.
- **Hosted vendors** — Passage was retired by 1Password (its domain now 301s to
  1password.com); Corbado's Laravel sample repo is archived; Hanko is AGPL
  self-host/cloud. All put an external dependency on the auth path of a
  DSGVO-sensitive product. Not pursued.

**Proposal (decision D1, owner's call):**

- **Option A — recommended on the evidence:** `web-auth/webauthn-lib`, constraint
  **`~5.3.3`** (resolves 5.3.9 today; stays off 6.0, whose migration notes already
  announce the allowed-origins API moving), plus a **thin in-house layer** in
  `app/Domain/Auth/` following the codebase's existing hand-rolled pattern: one
  engine for both surfaces, cache-backed challenge store, config-driven origin
  allowlist, one polymorphic credentials table (§7). Named risks: 16-package
  footprint; the engine is 94.6% one maintainer; 6.0 migration later.
- **Option B:** `laravel/passkeys` for the dashboard + a custom driver layer on the
  same engine — buys first-party routes/controllers for the easy half at the price
  of two integration styles, 0.x churn, the single-model FK and issue #41.
- **Option C:** build nothing now and wait for `laravel/passkeys` 1.0 — zero cost
  today; the driver half would **still** need the custom layer later, because its
  session-bound HTTP layer and single-model schema don't cover it.

Nothing was added to `composer.json` on this branch, per the task boundary.

---

## 3. Where it mounts — dashboard (guard `web`)

Confirmed from the controller, as asked:

- The dashboard **is** a cookie-session SPA on guard `web`. Login establishes the
  session with `Auth::guard('web')->login($user, $remember)` and immediately calls
  `$request->session()->regenerate()` (`AuthController.php:53-56`). The session
  exists because Sanctum's stateful pipeline (`EnsureFrontendRequestsAreStateful`)
  runs on `/api/*` (`bootstrap/app.php:35`), gated on the request's Origin/Referer
  being a stateful host; prod derives that host from `APP_URL`
  (`docker-compose.prod.yml:38-41`).

**What a passkey login must therefore do — and what stays identical:**

- A passkey assertion endpoint ends in exactly the same two lines: `Auth::guard('web')
  ->login($user, $remember)` + `session()->regenerate()`. **`session()->regenerate()`
  is unaffected** by how the user was verified; it rotates the session id against
  fixation exactly as it does after a password check. Nothing about the session
  machinery knows which credential ran.
- **Remember-me keeps working mechanically** — `login($user, true)` issues the
  remember cookie (`users.remember_token` exists, `0001_…_create_users_table.php:20`).
  What changes is *policy*: today the boolean comes from the login form checkbox
  (`frontend/src/lib/api/auth.ts:15`). A passkey assert request can carry the same
  boolean, or always set it true (a device-bound credential arguably implies
  "remember this device"). **Owner decision D4 (§10)** — low stakes either way, since
  prod sessions already default to ~1 year (`docker-compose.prod.yml:45-47`).
- **CSRF comes for free**: the SPA already fetches `/sanctum/csrf-cookie` and sends
  `X-XSRF-TOKEN` on every mutating call (`frontend/src/lib/api/client.ts:85,94-95`),
  and passkey routes mounted in `routes/api.php` ride the same stateful pipeline.
- **Route placement:** public pair (challenge options + assert) next to `POST login`
  with their own named throttles; authenticated pair (register options + attest,
  list/delete credentials) inside the existing
  `['auth:sanctum', 'user.account', 'dashboard.only']` group (`routes/api.php:252`).
- **`EnsureDashboardToken` needs no change** for dashboard passkeys: a cookie session
  authenticates as a `TransientToken`, `can('*')` is true, pass-through
  (`EnsureDashboardToken.php:89-93`).
- **Headers:** the Caddy `Permissions-Policy` (`docker/Caddyfile:42`) names no
  `publickey-credentials-*` directive. The spec default allowlist for
  `publickey-credentials-get/create` is `'self'`, and the dashboard calls WebAuthn
  from its own top-level origin — so no edge change is expected; flagged in §9
  anyway because the live edge was not tested.
- Passkeys here are **additive**: `users.password` stays NOT NULL and the password
  path stays. A passwordless-operator mode is out of scope (collides with the
  NOT-NULL column, `AuthenticateSession`'s password-hash binding, and §6 recovery).

---

## 4. Driver app — the case that matters

Premise (owner's framing, confirmed by §1): the driver already signs in without a
password; the passkey replaces a 6-digit code that **travels by email** with a
credential bound to the device — a bigger security win than the dashboard's. But the
app is native, so the WebAuthn `origin` the backend receives is not a URL:
`android:apk-key-hash:<base64url(SHA-256(signing cert))>` on Android, and the https
RP origin on iOS. Feasibility of the app side decides whether this half is a feature
or a wish.

### 4.1 Verdict on the app side

**Feasible — a feature, not a wish — with two narrow unknowns that only a build can
settle** (named below and in §9). Everything that could be measured without running
a build or touching credentials was measured, and none of it blocks.

App facts that frame the case (all measured in-repo unless noted):

- **iOS ships today and is NOT conditional**: live in the DE App Store as 1.1.0
  (released 2026-10-19, `minimumOsVersion` **16.4**, bundle `de.reidey.driver` —
  Apple lookup API), with an EAS iOS profile, ASC submit config and the manual
  `ios-build.yml` workflow. Android is `de.reidey.app` (production = AAB via Play;
  note `eas.json` submits to the **alpha** track).
- **Expo SDK 57.0.30 / RN 0.86.3** (lockfile), fully managed — no `android/`/`ios/`
  dirs; New Architecture is **mandatory** at this RN version (0.82+ ignores opt-outs).
- iOS floor 16.4 ≥ passkey floor (API iOS 15, full passkeys iOS 16) — **no iOS gap**.
  Android floor is minSdk 24 while platform passkeys need **API 28+**, so **devices
  on Android 7.1–8.1 can run the app but never passkeys** — one more reason the OTP
  path must stay (§6). On Android ≤ 13 the Credential Manager needs Google Play
  services (`credentials-play-services-auth`); the fleet is already GMS-biased
  (FCM presumes the Play Store app), but behavior on a GMS-less device is
  explicitly unverified (§9) — again: OTP fallback stays.
- Auth tail to reuse server-side: assert → the `loginVerify` tail →
  `createToken('driver-app')` (`DriverAuthController.php:307`); token lives in
  `expo-secure-store` (`src/lib/auth.tsx:11-12`). The app has **two principals**
  (driver + fleet-owner mode) — passkey scope is the **driver** principal; owner
  mode keeps its `fleet:read` OTP flow unless the owner decides otherwise.

### 4.2 Client module — two candidates, no official Expo module

No `@expo/passkeys` exists (npm 404; `expo-local-authentication` is biometrics-only,
explicitly "does not use WebAuthn"). Naming trap: the two candidates differ by one
letter and are different projects by different authors.

| | `react-native-passkey` (f-23) **3.6.2** | `react-native-passkeys` (peterferguson) **0.4.2** |
| --- | --- | --- |
| Last release / cadence | 2026-09-08; 6 releases in 2026 | 2026-08-05; 2 releases in 2026 |
| Weekly downloads | ~140k | ~191k |
| Module type | classic NativeModule → runs via RN's **legacy interop** (kept "for the foreseeable future" per RN 0.82 blog; repo precedent: ML Kit ships the same way) | **Expo Module** (ExpoModulesCore) — the more native fit for this app |
| `androidx.credentials` | **1.6.0** (current) | **1.3.0-alpha01** (stale alpha) |
| Known build risk | none reported for SDK 55–57 (also no success reports — absence of evidence) | **open issue #64**: iOS podspec pins 15.0 and fails against ExpoModulesCore's 16.4 floor on SDK 56; no fix merged; README even instructs `deploymentTarget: "15.0"` — below this app's 16.4. One issue (#68) shows 0.4.1 *running* on SDK 57, so it may build in some setups |
| Known runtime flake | iOS #96: ~5% error-1004 after reinstall | — |
| Config plugin | none (neither) — required app config is the same for both: add `ios.associatedDomains: ["webcredentials:reidey.de"]`; Android needs no manifest change for passkeys-only | same |

Neither candidate is proven on SDK 57/RN 0.86 by any source found; **proving one
compiles and completes a ceremony on a dev build is the first implementation task**
(decision D3). Rejected: `expo-passkey`/`expo-better-auth-passkey` (Better-Auth
plugins, not standalone), `expo-passkeys` (stale, iOS "in dev"), Android-only and
vendor-tied packages.

**Honesty note on "device-bound":** both platforms *sync* passkeys (Google Password
Manager / iCloud Keychain) and neither library exposes a non-syncable option. The
accurate security claim vs. today's OTP is: the credential is bound to the driver's
platform account and its devices, is phishing-resistant, and **nothing secret travels
by email** — not that it can never leave the phone.

### 4.3 Trust chains the backend must satisfy

**Android** (all from Google's docs, fetched 2026-10-27):

- Host `https://reidey.de/.well-known/assetlinks.json` — HTTP 200,
  `Content-Type: application/json`, **no redirects** — with relation
  `delegate_permission/common.get_login_creds` (Google's passkey example pairs it
  with `handle_all_urls`; community reports needed both to clear "RP ID cannot be
  validated"), target `package_name: de.reidey.app` + `sha256_cert_fingerprints`.
- The WebAuthn `origin` the backend receives is
  `android:apk-key-hash:<base64url-nopad(SHA-256(signing cert DER))>`. Conversion
  from the Play-Console hex fingerprint is mechanical (round-trip proven with
  node/Python/openssl during research).
- **Multiple origins must be allowlisted**, because different installs are signed by
  different certs: the **Play app-signing key** (production AABs are re-signed by
  Google; its SHA-256 comes from Play Console, not from any local file), the **EAS
  upload/preview keystore** (internal `apk` builds), and any debug key. Google's
  guidance says exactly this ("accept all the origins as valid on the app server").
  The same fingerprint set goes into `assetlinks.json`. The actual hash values are
  **unmeasured** (Play Console / `eas credentials` access — §9).

**iOS:**

- Entitlement `webcredentials:reidey.de` via `ios.associatedDomains` (absent from
  `app.json` today; Expo maps it verbatim and EAS syncs the capability), plus
  `https://reidey.de/.well-known/apple-app-site-association` containing
  `webcredentials.apps = ["<TeamID>.de.reidey.driver"]` — https, valid cert,
  **no redirects**; Apple's CDN picks it up within ~24h. The **Team ID is not in
  the repo** (§9).
- The `origin` in a native iOS ceremony is `https://reidey.de` (https + rpID — Apple
  engineer on the developer forums; corroborated by Corbado), so the server's origin
  check for iOS is the ordinary web origin.

### 4.4 Where `.well-known` lives, and what it returns today

`docker/Caddyfile` has no matcher for `/.well-known/*`, so it falls to the catch-all
→ the **Next.js frontend container** (`Caddyfile:107-110`). Live probe (plain GETs,
2026-10-27): both files return **404** (Next's HTML 404, `Via: 1.1 Caddy`, **no
redirect**) — a clean slate; nothing must be undone. Neither `frontend/public/.well-known`
nor `backend/public/.well-known` exists in the repo, and backend `public/` is only
file-served for `/storage/*` and `/email/*`. Next 16 serves dot-directories under
`public/` (verified in the installed source — `filesystem.js:195` applies no
dot-filter — and its docs exempt `.well-known/` from trailing-slash redirects), so
both files ship as statics in `frontend/public/.well-known/` via a normal frontend
image rebuild — **a deploy, therefore Phase 0 and owner-gated (§9)**. The
Content-Type served for the extensionless AASA file is unverified until then; a
one-line Caddy `header` rule is the fallback if Next guesses wrong. (`assetlinks.json`
ends in `.json`, so its Content-Type is safe.)

### 4.5 Shipping consequence (measured chain)

`runtimeVersion.policy = "fingerprint"` (`app.json:110-112`) + a new autolinked
native module + the new entitlement ⇒ **the fingerprint moves** ⇒ no OTA can carry
passkeys to existing installs; a **new store build on BOTH platforms** through the
manual `android-build.yml` / `ios-build.yml` workflows is required (repo precedent:
the UIScene fix and HANDOFF's own fingerprint measurements). `app_min_android`/`app_min_ios`
exists to force stragglers later — and per the standing rule, only after the builds
are live. Old binaries simply keep OTP.

### 4.6 Server half (engine facts from §2)

With `web-auth/webauthn-lib` the driver flow is cookie-less by construction: the
verify call takes the **original options object**, so the backend serializes the
`PublicKeyCredentialRequestOptions` into the **cache** under a one-time
`ceremony_id` (uuid) returned to the app with the options; the app echoes the id on
verify; TTL ≈ 60 s, delete-on-read — the same single-use semantics the OTP flow
already has (`OtpGuard::consume()`, `DriverAuthController.php:105`). No session, no
cookie jar, no `EnsureFrontendRequestsAreStateful` involvement. Driver ceremonies
validate against the §4.3 origin set (`android:apk-key-hash:…` entries verbatim +
`https://reidey.de` for iOS) via `setAllowedOrigins()` (≥ 5.3.3, §2). After a valid
assertion the controller reuses the OTP-verify tail: resolve the `Driver` by
credential id → `createToken('driver-app')` (`DriverAuthController.php:307`).
Enrollment runs **inside** an authenticated bearer session (`auth:driver`), so the
attestation endpoint is never public; both public assert endpoints get named
throttles in the `AuthRateLimits` pattern.


---

## 5. What breaks — El-Professor integration: nothing found

The integration authenticates with a dedicated `elprofessor:read` Sanctum PAT that an
operator mints from the dashboard. Both halves were read in full:

- **`EnsureDashboardToken` assumes nothing about how the operator logged in.** Its
  entire logic (`EnsureDashboardToken.php:85-111`): take `currentAccessToken()`; if
  it is `null` or `can('*')` — which is every SPA cookie session (`TransientToken`)
  and every full-ability PAT — pass through; otherwise confine the three known
  narrow abilities (`fleet-session:write`, `fleet:read`, `elprofessor:read`) to
  ability→"METHOD uri" allow-lists. It checks **token abilities and the route,
  nothing else** — no password, no session age, no credential type. A session
  established by a passkey assertion produces the same `TransientToken` and passes
  identically.
- **The minting path contains no password assumption.** `POST api/v1/elprofessor/token`
  (`routes/api.php:337`) sits behind `['auth:sanctum','user.account',ResolveTenant,
  'dashboard.only','user.active']` (`routes/api.php:270`) plus
  `can:connections.manage` + `elprofessor.enabled`. There is **no** `password.confirm`,
  no `Hash::check`, no `current_password` rule anywhere in backend app code outside
  the login/activation/legacy-driver paths (`PasswordCheck` call sites:
  `AuthController.php:26`, `CompanyActivationController.php:44,124`,
  `DriverAuthController.php:206,283`); `auth.password_timeout` is dead stock config.
  The mint itself: `$tenant->elprofessorTokens()->delete();
  $user->createToken('elprofessor', ['elprofessor:read'])` (`ElProfessorController.php:195-196`)
  — one link per company, replaced on every mint. The minted PAT then authenticates
  El-Professor's weekly pulls by its own token hash, fully decoupled from the
  operator's credential.
- **One real coupling to carry into the design** (behavior, not breakage): token
  hygiene is keyed to **password** changes today. An operator's password reset
  revokes all their PATs (`PasswordResetController.php:77`); a self-service password
  change revokes all but `ridy-extension` (`ProfileController.php:56`, const at `:24`)
  — the `elprofessor` token is revoked in both. Passkey **addition** triggers none of
  this (no hash change), which is correct. The plan must give passkey lifecycle
  events equivalent hygiene: **removing/replacing a passkey should offer the same
  "end other sessions / revoke tokens" semantics** — otherwise a stolen-device
  response rotates the password but a passkey compromise response has no analogous
  lever. Design point D6 (§10).
- Also noted: tokens holding abilities *not* listed in `EnsureDashboardToken` are
  deliberately unconfined (comment `:36-37`). No passkey design below mints any new
  PAT, so this stays theoretical — but any future "scoped passkey-management token"
  idea must remember this default-open property.

---

## 6. Enrollment & recovery

**Enrollment (both surfaces):** passkeys are registered only from an authenticated
context (dashboard session / driver bearer token), never during first login. Drivers
keep today's funnel: roster sync creates the row (`RosterSyncService.php:128`),
manager invites (install link, no code — `DriverInvitationService.php:87-90`), driver
signs in by OTP once, then the app offers passkey enrollment. Enrollment UX, prompts
and i18n (de/en/ar ×3 surfaces, §1 paths) are implementation-phase work.

**Lost phone (driver), measured against existing levers:**

1. New phone + same email inbox → self-service OTP (`routes/api.php:137-138`) →
   sign in → enroll new passkey. The old passkey must be **revocable**: the plan
   includes a credential list + revoke in the app and, mirroring today's manager
   levers, a manager-side "reset driver access" that revokes passkeys the way email
   change already revokes tokens + devices (`DriverController.php:208-210`).
2. Lost email access too → manager changes the driver's email
   (`routes/api.php:291`, revokes tokens + device tokens) or re-invites
   (`routes/api.php:367`) — both exist today, neither depends on OTP or password.
3. No `email` **and** no `uber_email` on the row → uninvitable **already today**
   (`DriverInvitationService.php:68-72`); passkeys change nothing for this group.

**Last passkey deleted:** with OTP kept as fallback (the premise), deleting the last
passkey degrades the account to today's OTP-only state — allowed, with a warning.
A "block deleting the last passkey" rule only makes sense under a future
OTP-suppression flag (below). **Owner decision D5.**

**Which account types would have no way back** — answered for the *hypothetical*
passkey-ONLY regime the question implies (passkey replaces both password and OTP),
from the recovery inventory measured in code:

| Account type | Levers independent of password+OTP | Passkey-only verdict |
| --- | --- | --- |
| Driver | manager re-invite (`api.php:367`), manager email change (`api.php:291`) | recoverable via manager |
| Fleet operator (multi-user company) | admin impersonation (`ImpersonationController.php:31-35`), admin password-set (`api.php:484`) — password-shaped | recoverable via super-admin only; `users.manage` is seeded but **no route uses it** — no company-side colleague management exists |
| Single-operator company | super-admin levers only (same as above) | fragile — one lost device = support ticket to platform admin |
| Reseller (tenant-less) | admin email/password edit (`CollectorController.php:100-104`) — password-shaped | recoverable via super-admin |
| **Super-admin (tenant-less)** | **none.** Self OTP reset (`api.php:117-119`) is its only lever; admin reset 404s for tenant-less users (`CompanyUserController.php:42`), impersonation targets tenant users only, delete refuses super-admins (`UserDirectoryController.php:90`) | **stranded** — a passkey-only super-admin who loses the device is locked out of the platform with no in-app recovery at all |

Consequence (recommendation input, not a decision): passkeys ship **additive
everywhere**. OTP stays the driver fallback; the password stays the operator
fallback. Any later hardening ("driver passkey-only once enrolled", per-tenant flag
suppressing emailed OTP when ≥1 passkey exists) is a separate owner decision **D7**
that must land together with support tooling — at minimum a manager-side passkey
reset, and it can never apply to `super_admin`.

---

## 7. Schema (prose only — deliberately NOT a migration file)

One polymorphic table serves both identity models — the shape is modeled on
laragear's shipped migration (a good reference even though that package is rejected):

- `webauthn_credentials`: string PK `id` (base64url credential id, 510),
  `authenticatable_type` + `authenticatable_id` (morph → `App\Models\User` /
  `App\Domain\Fleet\Models\Driver`, indexed), uuid `user_handle`, unsigned bigint
  `counter`, string `rp_id`, string `origin` (stores the **enrolling** origin — a
  web origin or an `android:apk-key-hash:…` string; both fit a `string` column),
  json `transports` nullable, uuid `aaguid` nullable, text `public_key`, string
  `attestation_format`, string `alias` nullable (the "Pixel 8 von Ali" label for
  management UIs), timestamp `disabled_at` nullable, timestamps.
- Attestation policy: `none` — no AAGUID trust chains, matching the engine default
  and the DSGVO "detect, don't surveil" posture (no device-fingerprinting data
  beyond what the ceremony needs).
- Open design choice for implementation: encrypt `public_key` at rest (laragear
  does, which welds logins to `APP_KEY` — a key rotation would break every passkey)
  vs. store the public key as the public material it is. To be decided with D1.

**No migration file exists on this branch by design** (task boundary: nothing
someone could run by accident). The migration gets written in the implementation
phase and lands on `main` together with its feature, where the deploy's
`php artisan migrate --force` is the intended, normal path.

---

## 8. Rollout plan (phased, every phase gated by an owner decision)

**Phase 0 — prerequisites (the only server-facing phase; owner-gated):**

1. Ship `frontend/public/.well-known/assetlinks.json` +
   `apple-app-site-association` (a normal frontend image rebuild = a deploy).
   Verify live: HTTP 200, `application/json`, no redirect (§4.4); a one-line Caddy
   `header` rule is the fallback for the extensionless AASA file.
2. Collect the identity facts only the owner can reach (§9): Play-Console
   app-signing SHA-256 (+ upload-key SHA-256), EAS keystore fingerprint(s), Apple
   Team ID.
3. Optional sizing: one read-only prod query on `device_tokens.os_version` — how
   many driver devices sit below Android 9 (can never use passkeys).

Nothing in this phase touches auth; it can ship long before any passkey code.

**Phase 1 — dashboard (no store build, smallest blast radius):**
add the D1 dependency · write the §7 migration · build the thin layer in
`app/Domain/Auth/` (options/verify services, cache challenge store, config:
`rp_id = reidey.de` + origins) · four endpoints — register options/verify behind
`auth:sanctum + user.account + dashboard.only`, login options/assert public behind
new named throttles beside `throttle:credentials` · assert tail =
`Auth::guard('web')->login($user, $remember)` + `session()->regenerate()` (§3) ·
profile UI to list/add/revoke credentials · i18n de/en/ar · feature tests driven by
captured attestation/assertion vectors (none of the candidate packages ships a
virtual authenticator — upstream's own fixture style is the reference). Owner
merges; the push-to-main release deploys it.

**Phase 2 — driver app (the valuable half):**
first task is D3's proof — a **dev build** showing the chosen module compiles and
completes one real ceremony on SDK 57 (§4.2's two unknowns die here) · backend
driver endpoints per §4.6 · app UI: enrollment offered after an OTP login; login
screen offers passkey first with **OTP permanently remaining** as fallback (§4.1
device floors + §6 recovery); owner-mode (`fleet:read`) unchanged · store builds for
**both** platforms via the manual workflows · staged rollout; raise
`app_min_android`/`app_min_ios` only after the builds are live (standing rule).

**Phase 3 — optional hardening (D7, separate decision):** per-tenant suppression of
the emailed OTP once a driver has ≥ 1 passkey; requires manager-side passkey-reset
tooling first; never applies to `super_admin` (§6).

Every phase ends at an owner gate; nothing auto-proceeds from this document.

---

## 9. Explicitly unverified / needs the server (named, not guessed)

Collected from every research track; each item names what unblocks it.

From the library research:

- **Composer resolver outcome** — `composer require --dry-run` against the real
  lock was not run (write-adjacent, barred); the "+16 packages, no conflicts"
  verdict rests on constraint inspection of `composer.lock`. Needs: one dry-run at
  implementation time.
- **No upstream PHP was executed** (sandbox denied running downloaded code). The
  android-origin YES for `webauthn-lib` rests on reading the pinned source (re-read
  first-hand for this doc) plus the maintainer's four dedicated tests; for laragear
  on source plus a local `parse_url()` probe. Needs: the Phase-1 feature tests.
- **Reidey's real `android:apk-key-hash` values** — same Play Console / EAS /
  device gap as the driver-app list above.
- **`laravel/passkeys` issue #41 scope** (iOS-Safari-only or wider) — matters only
  if Option B is picked.
- **`webauthn-lib` 6.0** — no release date; its replacement allowed-origins API not
  inspected. The `~5.3.3` pin defers this; revisit on release.

From the driver-app research (each with what unblocks it):

- **Play Console values** — the app-signing-key and upload-key SHA-256 fingerprints,
  Play App Signing enrollment, which versions sit on which track. Needs: the owner's
  Play Console (Release → Setup → App signing).
- **EAS keystore fingerprints** (preview/internal builds; whether preview and
  production share a keystore). Needs: `eas credentials` under the project account —
  owner-run; deliberately not run here.
- **Apple Team ID** (goes into the AASA `apps` entry) and the ASC state of 1.1.1.
  Needs: the Apple developer account.
- **Build-level proof** that the chosen module compiles and completes a ceremony on
  Expo SDK 57 / RN 0.86 under `useFrameworks: static` @ iOS 16.4 — including whether
  `react-native-passkeys` issue #64 reproduces on SDK 57, and the f-23 AGP 8.13-vs-8.12
  buildscript interaction. Needs: one dev build (the first implementation task, D3).
- **Real `origin` strings from physical devices** (production-signed and
  preview-signed installs), **behavior on GMS-less / outdated-GMS Android**, and the
  iOS error-1004 reinstall flake rate. Needs: devices + a test build.
- **Fleet OS distribution** — how many driver devices sit below Android API 28 (can
  never use passkeys) — measurable read-only from `device_tokens.os_version`/`platform`
  on prod. Needs: one owner-run query.
- **Whether platform passkeys can be forced non-syncable** — no authoritative source
  found either way; the doc's security claim in §4.2 is worded accordingly.

From the backend audit + this document:

- **Live prod env values** (`SESSION_*`, `SANCTUM_*`, `APP_URL`) — CI rewrites prod
  `.env` from GitHub secrets; repo defaults were cited instead. Needs: owner reading
  the server, or the existing runbook paths.
- **Live behavior of `https://reidey.de/.well-known/*`** — inferred from
  `docker/Caddyfile` matchers only; Cloudflare rules are not in the repo. Needs: one
  public GET after (or before) the static files ship.
- **Content-Type Next emits for an extensionless `apple-app-site-association`** —
  unverified; may need a Caddy header rule. Needs: staging/prod check at Phase 0.
- **`AuthenticateSession` behavior against a null password hash** — irrelevant while
  passkeys are additive (passwords stay); blocks any passwordless-operator idea.
- **Production data distribution** — how many single-operator companies, drivers
  without email (`§6` fragility sizing). Needs: one read-only query on prod, owner-run.
- **Whether any deployed state diverges from `main` @ 6c50292** — this research read
  the repo, not the containers.

---

## 10. Decisions for the owner (nothing proceeds without them)

| # | Decision | Options (measured trade-offs in the section cited) |
| --- | --- | --- |
| D1 | Server library | A: `web-auth/webauthn-lib ~5.3.3` + thin in-house layer (recommended on the evidence — the only maintained path covering BOTH surfaces); B: `laravel/passkeys` for the dashboard + custom driver layer; C: wait for `laravel/passkeys` 1.0 (§2) |
| D2 | Ship order | dashboard first (no store build) → driver later; or driver-only; or both |
| D3 | Driver-app module + build slot | `react-native-passkey` 3.6.2 (f-23) vs `react-native-passkeys` 0.4.2 (peterferguson) — §4.2; first implementation task either way is a dev build proving compile + one ceremony on SDK 57; then schedule the two store builds |
| D4 | Remember-me on passkey login | carry the checkbox vs. always-on (§3) |
| D5 | Last-passkey deletion policy | allow with warning (OTP remains) vs. block (§6) |
| D6 | Passkey lifecycle hygiene | mirror password-change token revocation on passkey remove/replace (§5) |
| D7 | Future hardening (OTP suppression once enrolled) | separate, needs support tooling first, never for super_admin (§6) |

