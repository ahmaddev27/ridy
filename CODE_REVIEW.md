# Reidey — System-Wide Code Review

_Senior staff engineering review of the Reidey fleet-dispatch SaaS monorepo (`c:\laragon\www\DASHCAM`). Reviewed: Laravel 13 backend, Next.js dashboard, Expo driver app, Node dispatch-daemon, browser extension, and infra._

## Executive Summary

Overall the system is **in good architectural health**. The backend shows real engineering maturity: a clean `Domain/` layer, a well-designed multi-tenant global scope (`TenantScope` + `BelongsToTenant`) reinforced by a defense-in-depth `AuthorizesTenantResource` guard and a deliberate middleware-priority fix that runs `ResolveTenant` before route-model binding, guarded/idempotent offer state transitions with row locking, and consistently thoughtful comments explaining _why_. Sanctum cookie SPA auth on the frontend keeps tokens out of `localStorage`; the driver app stores tokens in the Keychain/Keystore. Tenant isolation and authz are the strongest parts of the system and I found no cross-tenant IDOR in the reviewed paths.

The **top 3 risks** are concentrated in the data-capture edges, not the core:

1. **DSGVO / PII exposure in the browser extension** — sensitive decrypted Uber fleet data (driver earnings, VINs, plates) is broadcast with `postMessage(..., "*")`, and the passive `/api/*|/graphql` tap indiscriminately forwards banking/invoice/document responses to the backend. This directly contradicts the project's "detect, don't surveil" DSGVO posture.
2. **Synchronous external geocoding on hot ingest/request paths** — each offer is geocoded (Nominatim + OSRM, multi-second timeouts) _inline and per-offer_ inside the ingest loop, and the live-map endpoint reverse-geocodes every waypoint per poll. This throttles ingest throughput and the fleet map under load.
3. **Correctness bugs in the driver app** — the offer-detail screen falsely reports "Expired" for any offer not on list page 1, and the accept-window countdown is driven by a hardcoded 10s instead of the real window.

Findings are ranked per section, most-severe first.

---

## Backend (Laravel)

### High · `app/Domain/Dispatch/DispatchOfferIngestor.php:108-112` (+ `DispatchIngestController.php:30-56`, `DispatchOfferController.php:138-161`) · Synchronous per-offer geocoding blocks the ingest hot path
`ingest()` calls `$this->geocoder->enrich($record)` **synchronously** for every routed offer, before the push. `enrich()` issues external Nominatim + OSRM HTTP calls (5–8s timeouts each — see `TripGeocoder.php:496,557,703,845`). Both ingest entry points (`DispatchIngestController::ingest` and `DispatchOfferController::ingest`) loop over an offers batch, so a batch of N offers with cold-cache addresses performs N sequential multi-second round-trips while holding the daemon's (or manager's browser's) ingest request open.
**Failure scenario:** a fleet comes online and the daemon forwards a burst of offers; each cold geocode adds seconds, the ingest request times out or serializes, and time-sensitive push notifications (5s accept window) are delayed past usefulness.
**Fix:** always enqueue `GeocodeOffer` (already exists) instead of geocoding inline; if the push genuinely needs distance, geocode only the single pushed offer with a tight (~1s) timeout and fall back to no-metrics rather than blocking the batch.

### High · `app/Http/Controllers/Api/V1/DriverController.php:47-100` · Live-map endpoint reverse-geocodes every waypoint per poll (N+1 + sync HTTP)
`live()` maps over all live drivers and, per driver, calls `PostalCodes::nearest()` and per waypoint `$geo->reverse(lat,lng)`. `reverse()` (`TripGeocoder.php:483`) does one `geocode_cache` DB lookup on a warm hit and a synchronous Nominatim call on a cold one. With the fleet map polling continuously, this is an N+1 (one cache query per waypoint per driver every poll) that degrades to synchronous external HTTP inside a user-facing GET on any cache miss.
**Failure scenario:** a fleet with dozens of active trips opens the map; each poll fans out to hundreds of cache queries and, after a coordinate shifts, blocking Nominatim calls — the map endpoint slows and can time out.
**Fix:** batch the waypoint labels (single `whereIn` against `geocode_cache`), never call the network reverse-geocode from this request path (return the cached label or the nearest-town fallback and let a job fill cold entries), and consider a short response cache keyed on the fleet's last status sync.

### Medium · `app/Http/Controllers/Api/V1/Driver/DriverAuthController.php:40-42,87-99` · Permanent App-Store demo OTP backdoor (`aa20589@gmail.com` / `000000`)
A hardcoded email + fixed code `000000` bypasses the emailed OTP **even in production** (`isReviewDemoLogin`). It is constant-time and scoped to one demo driver, and the comment says "remove after approval," but it is a standing credential-free login for a known account.
**Failure scenario:** the constant survives past App Store approval; anyone who reads the (client-shipped or leaked) constant signs in as that driver indefinitely.
**Fix:** gate it behind a config flag defaulting off in production, or remove it now that review is presumably complete; at minimum add an expiry date check.

### Medium · `app/Domain/Dispatch/SupplierNetworkRecorder.php:64-74` · Per-offer JSON-path dedup query on a non-indexed column
For every ingested offer, `offer()` runs `where('payload->offerUUID', $uuid)->where('created_at','>=', now()->subSeconds(20))->exists()`. `payload` is a JSON column with no generated-column index; the 20s `created_at` bound helps only if `created_at` is indexed on `dispatch_network_logs`.
**Failure scenario:** as the network-log table grows, each offer ingest adds a JSON scan, compounding the ingest-path latency already noted above.
**Fix:** persist `offer_uuid` as a real indexed column on `dispatch_network_logs` and dedup on it, or drop the cross-path dedup and de-duplicate at read time in the admin feed.

### Medium · `app/Domain/Dispatch/DispatchOfferIngestor.php:37` + `app/Domain/Tenancy/TenantContext.php` · TenantContext singleton is never reset after ingest; latent leak on queue/Octane
`TenantContext` is a request-lifetime singleton mutated by `ingest()` (`$this->context->set($tenantId)`) inside a loop that can span multiple tenants (daemon path routes each offer to its own session/tenant). Under FPM this is per-request and safe, but the context is never `forget()`-ed at loop end. On a long-lived worker (queue/Octane) the last tenant's id persists into the next unit of work.
**Failure scenario:** if offer ingestion is ever moved to a queued job (or Octane is adopted), a subsequent job with no explicit tenant inherits the previous tenant's scope and reads/writes the wrong company's rows.
**Fix:** reset the context in a `finally` after each ingest (or wrap per-offer), and add a queue `looping`/`after` hook that calls `TenantContext::forget()`.

### Low · `app/Http/Controllers/Api/V1/DispatchDaemonController.php:159-161` · Daemon endpoints accept any session id under one shared secret
`find()` resolves `UberFleetSession::withoutGlobalScopes()->findOrFail($id)` with no check that the session belongs to the shard making the call. Any holder of `X-Dispatch-Secret` can post cookies/roster/statuses for _any_ tenant's session.
**Failure scenario:** a misconfigured or compromised shard writes another tenant's cookies/roster. Contained today (single trusted secret, internal-only network) but violates least privilege in a multi-shard deploy.
**Fix:** scope writes to the requesting shard (`where('shard_id', $shard->id)`), or issue per-shard secrets.

### Low · `app/Domain/Dispatch/DispatchOfferIngestor.php:135-141` + `app/Support/RidyLog.php:18-22` · Full raw offer (rider PII) written to logs when `APP_DEBUG` is on
`RidyLog::event('dispatch_offer.ingested', ['offer' => $offer])` logs the entire raw payload (rider first name, pickup/dropoff addresses). It is correctly gated on `config('app.debug')`, so production is safe _only if_ `APP_DEBUG=false`.
**Failure scenario:** `APP_DEBUG` accidentally left on in production writes rider PII and driver data to `storage/logs/ridy.log` — a DSGVO exposure.
**Fix:** redact rider/address fields even in debug logs, and add a deploy assertion that `APP_DEBUG` is false in production.

### Low · `app/Domain/Dispatch/OfferLifecycle.php:178-201` · `expirePending(null)` loads all pending offers across all tenants into memory
The scheduled sweep loads every pending offer (with driver) and filters in PHP. The "pending set is small" assumption holds now but is unbounded.
**Fix:** push the deadline predicate into SQL where possible, or chunk the sweep.

**Verified-sound (no action):** `TenantScope`/`BelongsToTenant`, `ResolveTenant` (no-tenant users are 403'd, super-admin is the only cross-tenant identity), `AuthorizesTenantResource` (explicit 404 ownership check), `EnsureUserAccount` (blocks driver tokens on manager routes), `EnsureSuperAdmin`, `VerifyDispatchSecret` (blank-secret guard + `hash_equals`), the reseller group's `can:codes.generate` gate, OTP handling (`GeneratesOtp` blocks the fixed test code in production; `password` uses the `hashed` cast), and `OfferLifecycle` transitions (row-locked, guarded, idempotent).

---

## Frontend (Next.js dashboard)

### Verified-sound core (reviewed directly)
- `src/lib/api/client.ts` — Sanctum cookie SPA auth (`credentials:"include"`), CSRF primed via `/sanctum/csrf-cookie` and echoed as `X-XSRF-TOKEN`, network/5xx errors normalized to a typed `ApiError`. **No bearer token in `localStorage`** — the correct posture.
- `src/components/auth/auth-provider.tsx` — auth state derives from `fetchMe()`; client guards (`admin-guard`, `app-guard`, `reseller-guard`) are UX gates only, with real enforcement on the backend.

### Medium · `src/lib/api/client.ts:34-36,80,104` · Redundant CSRF-cookie fetch on every mutation
`ensureCsrfCookie()` unconditionally fetches `/sanctum/csrf-cookie` before every `withCsrf` request and every `apiUpload`, even when the `XSRF-TOKEN` cookie already exists. Sanctum needs it only once per session.
**Failure scenario:** every POST/PUT/PATCH/DELETE incurs two round trips instead of one; rapid saves double request volume and latency.
**Fix:** skip `ensureCsrfCookie()` when `readCookie("XSRF-TOKEN")` is already present; prime only when missing.

### Low · `src/lib/extension.ts:78,108,135,182` (receivers `72-74,101-103,128-130,172-177`) · Extension bridge uses `postMessage("*")` and receivers don't check `event.origin`
Messages carrying `driverUuid`s and sync requests are posted with `targetOrigin "*"` and accepted based only on `event.source===window` + a `data.source` tag.
**Failure scenario:** if the dashboard is ever framed by another origin, that parent can read the `"*"`-broadcast driver UUIDs and post spoofed `*-done` replies that pass the `source===window` check.
**Fix:** use `window.location.origin` as `targetOrigin` and validate `event.origin` in each `onMessage`.

### Low · `src/lib/api/client.ts:3` · API base URL falls back to `http://localhost:8000`
`process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"`. If the env var is missing in a production build, the dashboard silently points at localhost.
**Fix:** fail the build (or throw at module load) when `NEXT_PUBLIC_API_URL` is unset in production.

### Low
- `src/hooks/use-async.ts:37-54` — `run` is memoized with empty deps and reads `fetcherRef.current`; the mount effect depends only on `[run]`. A caller that swaps filter/id state into a new fetcher closure won't refetch and shows stale data unless it calls `refetch()` manually. Accept a deps/key array and include it in the effect. _(Design gotcha — confirm against a specific page before treating as a live bug.)_
- `src/components/layout/notifications-bell.tsx:29,47-49` — `closeTimer` `setTimeout` is never cleared on unmount; navigating away during the 120ms close grace fires setState on an unmounted component. Add a cleanup effect.
- `src/lib/api/client.ts:9` — `localStorage.getItem` can throw in privacy/blocked-cookie modes; wrap it in try/catch and default to `"de"` so an error path doesn't throw a secondary error.

**Verified benign (no action):** the Firebase web `apiKey` + VAPID public key in `web-push.ts` are public-by-design client keys; the `dangerouslySetInnerHTML` in `app/layout.tsx` is a static inline theme script with no user input.

> Note: individual app/admin/reseller **page** components (offers, drivers, map, dashboard, admin tabs, billing modals) were delegated to sub-agents whose results had not returned at report time — residual risk there is in per-page data-fetch loops and render-time work, not the auth/transport layer, which is sound.

---

## Driver App (Expo / React Native)

_The "committed secrets" premise was checked against `git ls-files`: `ios-asc-key.p8` is **not** tracked (correctly `.gitignore`d); only `GoogleService-Info.plist` and `google-services.json` are tracked and both are client-side Firebase config, not secrets._

### High · `app/offer/[id].tsx:71-90` · Offer detail shows "Expired" for any offer not on list page 1
The loader fetches a single list page and does `r.data.find(o => o.id === id)`; a miss sets `error=true`, rendering `t("offer.expired")`. It also re-runs the full-list fetch every 4s.
**Failure scenario:** a driver opens an older ride (page 2+) or taps a push for an offer newer offers have pushed off page 1 — the screen wrongly says "expired" for a valid offer.
**Fix:** add and call a real `GET /driver/offers/{id}` by-id endpoint.

### Medium · `app/settings.tsx:33-62` + `src/lib/push.ts:37-45` · Notification / sound / haptic toggles are dead
The three prefs persist to SecureStore but nothing reads them; `setNotificationHandler` unconditionally returns `shouldPlaySound:true` and `_layout.tsx` always registers for push.
**Failure scenario:** a driver disables "Offer notifications" / "Sound" and still gets loud pushes.
**Fix:** gate the handler/registration on the stored prefs, or remove the toggles.

### Medium · `app/offer/[id].tsx:29,101` vs `src/components/offer-card.tsx:116-124` · Two inconsistent, wrong accept-window sources
The detail ring hardcodes `COUNTDOWN_SECONDS = 10` and ignores `offer.accept_window_seconds`; the card shows `accept_window_seconds` with a "…remaining" label but as a static, non-decrementing number.
**Fix:** drive the detail countdown from `accept_window_seconds` (fallback 10) and make the card value live or relabel it.

### Low
- `app/offer/[id].tsx:40-50` — countdown RAF loop restarts every 4s poll because the effect depends on the whole `offer` object (fresh reference each `.find()`); key it on `offer?.id`/`received_at`/`status`.
- `src/lib/api.ts:315-317` — `markOffersSeen()` is dead code (never called).
- `src/lib/i18n.ts` — large block of dead translation keys from the removed password flow (`activate.*`, `forgot.*`, `settings.security`, …).
- `app.json:29-32` — `POST_NOTIFICATIONS` Android permission listed twice.
- `ios-asc-key.p8` (working tree) — ASC signing key sits unencrypted in the project folder (gitignored, not leaked); prefer injecting from an EAS/CI secret at build time.
- `src/lib/auth.tsx:121-126` — `verifyCode` casts `res.data.owner`/`driver` to `DriverProfile` with no null check; add a defensive guard.

**Verified-sound (no action):** tokens/owner flags in `expo-secure-store`; the API client's send-time token capture + owner-aware 401 handling avoid the self-logout race; push `offer_id` is regex-validated before routing; `update-gate.tsx` allowlists the update URL host against open-redirect.

---

## Dispatch Daemon (Node)

### Medium · `src/stream.js:13-30,141-187` (with `extension/background.js:233-250,479-489`) · Uber-contract constants/mappers duplicated across daemon and extension
`ROSTER_FILTERS`, the GetDriverLiveLocation status-normalization map, and metric maps are copy-pasted between daemon and extension — including the identical typo `complianceStatusFitler`, evidence of copy-paste drift.
**Failure scenario:** Uber changes a field; one copy is updated, the other silently returns stale/empty data.
**Fix:** extract the shared Uber request/response contract into one module (or shared JSON schema) consumed by both.

### Low
- `src/stream.js:315-339` — `readSse` accumulates `buffer` and only trims on `\n`; a hostile/wedged upstream that streams bytes without a newline grows the buffer unbounded. Cap and reset beyond a sane frame bound. (The extension's `makeLineParser` shares the shape.)
- `src/api.js:20-21` — backend error bodies are thrown/`console.error`'d/Sentry'd verbatim; if the backend ever reflects request context, fragments leak into telemetry. Cap the echoed length. (No secret is echoed today — precautionary.)

**Verified-sound:** the reconnect/auth-failure control flow (`handleAuthFailure → stop() → run()` loop break) and the `isAllowedApiUrl` host allowlist (exact-hostname, https-for-remote) — no SSRF vector.

---

## Extension (Browser)

### High · `extension/pair.js:131,140,147,148,154` · Sensitive Uber PII broadcast to `postMessage(..., "*")`
The roster/metrics/vehicles/statuses response handlers reply with `window.postMessage({...res}, "*")`, where `res` carries decrypted Uber fleet data — driver **earnings, trip counts, acceptance rates**, and vehicle **VINs/plates**. `"*"` lets any frame/origin framing or embedded in the dashboard read it. The same file already uses `location.origin` for `announce`/`ridy-pair-ack`, so this is an inconsistency, not a platform constraint.
**Failure scenario:** a third-party script/iframe (ad, analytics, clickjacking frame) on the dashboard registers a `message` listener and siphons driver earnings/PII — a DSGVO breach against the project's stated posture.
**Fix:** replace `"*"` with `location.origin` on all five `postMessage` calls.

### High · `extension/inject.js:53-63,30-32` + `extension/content.js:100-107` · Passive tap forwards ALL supplier `/api/*` and `/graphql` responses (banking, invoices, documents) to the backend
`isCapture` matches every `supplier.uber.com` `/api/` or `/graphql` response (up to 1 MB) and tees the full body to `/api/v1/supplier/capture`. This exfiltrates far more than trip offers — bank/payout details, invoices, driver documents, compliance PII — whenever the manager browses any Fleet page.
**Failure scenario:** the manager opens the Banking or Documents tab; their and their drivers' financial/identity data lands in the admin "Network feed" with no filtering or consent scoping.
**Fix:** allowlist specific endpoints/`operationName`s worth capturing; exclude known-sensitive endpoints; document the DSGVO basis.

### Medium
- `extension/inject.js:171-183` — the XHR recv tap reads `this.responseText` (retains the entire stream text) on `progress` for the long-lived RAMEN stream and never removes the listener; memory grows unbounded on a tab left open for hours. Prefer the fetch/EventSource incremental taps, or cap/reset.
- `extension/pair.js:35` (+ `manifest.json` `host_permissions`/`content_scripts`, `ALLOWED_API_HOSTS`) — dev pairing origins (`localhost:3000`/`127.0.0.1`) ship in the released build (v1.15.3). A local page (or malware bound to localhost:3000) on a manager's machine can pair/redirect the extension's captured Uber session. Gate localhost behind a dev-only build flag.

### Low
- `extension/background.js:88-90,153-156` — `fingerprint` hashes cookie value _lengths_, so a same-length rotation (`lastSync === fp`) is never re-synced; the browser path leaves the stored cookie stale until an unrelated change. Hash a value digest or rotation counter. (Low — the daemon's `absorbCookies` handles rotation for actively-streamed sessions.)

---

## Infra (docker-compose / deploy) — high level

- Backend ports are internal-only behind Caddy; `trustProxies(at: '*')` is intentional and correct given that topology (documented in `bootstrap/app.php`). Ensure the compose network genuinely prevents direct access to the app container so the trust-all-proxies stance is safe.
- The temporary `driver_auth_401` diagnostic render hook in `bootstrap/app.php` logs token state on every driver 401 — remove once the "session_invalidated" root cause is confirmed (it is labeled TEMPORARY).
- Confirm `APP_DEBUG=false` and a non-`log` mailer in production (the code already `Log::critical`s the mailer misconfig in `GeneratesOtp`).

---

## Top 10 to Fix First

| # | Severity | Location | Issue | Fix |
|---|----------|----------|-------|-----|
| 1 | High | `extension/inject.js:53-63` + `content.js:100-107` | Blanket `/api\|/graphql` tap exfiltrates banking/invoice/document PII | Allowlist specific endpoints; exclude sensitive ones |
| 2 | High | `extension/pair.js:131-154` | Decrypted earnings/VIN/plate PII broadcast to `postMessage("*")` | Use `location.origin` |
| 3 | High | `DispatchOfferIngestor.php:108-112` (+ both ingest controllers) | Synchronous per-offer geocoding blocks the ingest hot path | Always enqueue `GeocodeOffer`; tight-timeout single geocode at most |
| 4 | High | `DriverController.php:47-100` | Live-map reverse-geocodes every waypoint per poll (N+1 + sync HTTP) | Batch cache lookup; never network-geocode in the request |
| 5 | High | driver-app `app/offer/[id].tsx:71-90` | Offer detail falsely shows "Expired" for offers off list page 1 | Add a by-id offer endpoint |
| 6 | Medium | `DriverAuthController.php:40-42,87-99` | Permanent production demo-OTP backdoor (`000000`) | Config-gate off in prod or remove |
| 7 | Medium | `SupplierNetworkRecorder.php:64-74` | Per-offer JSON-path dedup on a non-indexed column | Store indexed `offer_uuid` column |
| 8 | Medium | `TenantContext` + `DispatchOfferIngestor.php:37` | Singleton never reset after ingest; latent leak on queue/Octane | `forget()` in `finally` + queue hook |
| 9 | Medium | driver-app `app/settings.tsx` + `push.ts` | Notification/sound/haptic toggles are dead | Wire prefs into the handler or remove |
| 10 | Medium | `extension/inject.js:171-183` | XHR recv tap grows memory unbounded on long-lived stream | Use incremental fetch/EventSource tap or cap buffer |
