# Reidey — Engineering Handoff

A complete operational + architectural handbook. Audience: an engineer (or another AI model) picking up the project with no prior context. Everything here is verified against the code on `main`; file paths are relative to the repo root unless noted.

> **This is the living agent guide — the canonical project memory, kept in git.** Whenever you change how a subsystem works, update this file in the same commit and push it, then add a dated line to the change log below. If anything here disagrees with the code, **the code wins** — fix this file. Start here before touching the project.

---

## 0. Change log (most recent first)

Newest wave of changes, so an agent resuming work knows what moved. Older history lives in `git log` and `docs/04-progress.md`.

- **2026-09-02 — Multi-stop verified working end-to-end (and the real data shape confirmed).** A live 2-stop offer (id 5192, rider "Winston": Luisenstraße → **Graudenzer Straße** → Alarichstraße) rendered perfectly in the driver app — **"Mehrere Stopps · 2 Abgabestellen"**, numbered intermediate stop with `+6.9 km`, final drop with `+2.0 km` — matching the stored `stops[]` exactly (`stops_count=2`, `geo_source=uber`, cumulative 8 882 m). **Key correction to the earlier finding:** Uber encodes an intermediate stop as **`CHECKPOINT_TYPE_VIA`**, and only the *final* destination as `CHECKPOINT_TYPE_DROPOFF` — so a multi-stop trip's waypoints are `PICKUP · VIA[…] · DROPOFF`, **not** two `DROPOFF`s. (The long "senat"/offer-5171 hunt searched for `%DROPOFF%DROPOFF%`, the wrong pattern, and rightly found nothing — that trip genuinely carried a single drop in the data we captured; its 2nd stop, if real, was never in any snapshot we received.) **No extra Fleet Hub endpoint is needed:** whenever Uber includes a `VIA` waypoint in `GetDriverLiveLocation`, the existing pipeline (`SyncTripFromWaypoints` → `TripGeocoder::applyFromWaypoints`, `stops_count = count − pickup`, `notifyMultiStop` at ≥2) captures and pushes it. To audit a multi-stop trip, look for `%CHECKPOINT_TYPE_VIA%` in `dispatch_network_logs` `kind='status'`, not double-`DROPOFF`.
- **2026-09-02 — Self-hosted OSRM live on prod (with a hard-won lesson).** After the env-passthrough fix, self-hosted OSRM produced **garbage distances** (e.g. a 3 km trip → 100 000+ km). Root cause: the all-Germany `osrm-extract`/`partition`/`customize` pipeline had been **interrupted with Ctrl+C** repeatedly, leaving a corrupt graph (a plain-text `.osrm.timestamp` also can't be faked — it's an OSRM tar container). A **clean, uninterrupted background build** produced correct distances (verified 9.15 km for a real offer). **NEVER interrupt an OSRM build.** The correct procedure is a single detached `bash` job: download the pbf with `alpine + wget` (the osrm image has no `curl`) → `osrm-extract -p /opt/car.lua` → `osrm-partition` → `osrm-customize` → start, then **verify a test route returns a sane distance BEFORE pointing the backend at it**. Prod is now on self-hosted (`config('services.geo')` = `http://nominatim:8080` / `http://osrm:5000`); the `NOMINATIM_URL`/`OSRM_URL` GitHub secrets are set so deploys keep it. `docs/self-hosted-geo.md` has the full hardened runbook.
- **2026-09-02 — System Health Nominatim probe fixed.** `InfrastructureHealthService` now probes Nominatim at `/search?format=json&limit=1&q=a` (4 s timeout) instead of the bare root, which hung on the self-hosted container and false-negatived a working geocoder as **Down**.
- **2026-09-02 — Live dashboard over WebSocket (tenant-isolated).** `OfferBroadcast` now fires on `company.{tenantId}` (every offer, linked or not) beside the existing `driver.{driverId}` channel; `routes/channels.php` authorizes it against `user.tenant_id` so a manager can only ever receive their OWN company's events. The dashboard + offers pages subscribe via `frontend/src/lib/realtime.ts` (`useCompanyRealtime`, laravel-echo + pusher-js, Sanctum-cookie authorizer hitting `/api/v1/broadcasting/auth`) and refresh instantly on `.offer.changed`, with the existing poll as the fallback. Needs the frontend built with `NEXT_PUBLIC_REVERB_KEY` (defaults to `REVERB_APP_KEY` in compose); empty → it just polls.
- **2026-09-02 — Self-hosted geo now actually used.** The `x-app-env` anchor never forwarded `NOMINATIM_URL`/`OSRM_URL`, so despite the geo containers running, `config('services.geo')` stayed on public OSM. Added both to the shared env (empty → public OSM, opt-in to `http://nominatim:8080` / `http://osrm:5000`). Verify with `config('services.geo')` + hitting the internal services; recover old distance-less offers with `offers:backfill-geo --reset`.
- **2026-09-02 — One fixed currency format in the driver app.** Prices rendered three ways ("4,10 EUR" / "€1.77" / "1,77 €/km") plus a double-€ bug. Standardised on de-DE everywhere: fare `"4,10 €"`, rate `"1,77 €/km"`, distance `"2,3 km"` (Latin digits, € after), always from the numeric amount (never Uber's pre-formatted string). See §4.

- **2026-09-02 — Driver phone model + OS captured per device.** `device_tokens` now carries `device_name` + `os_version` (both nullable). The driver app gathers `Device.modelName` / `Device.osVersion` via **expo-device** (already a dep) in `registerForPush` and passes them through `api.registerDevice` / `api.fleetRegisterDevice`; the two register endpoints (`DriverDeviceController`, `FleetDeviceController`, sharing a `CapturesDeviceInfo` trait) accept them as **optional** and persist only what the client sent (an older build never wipes a captured value). `DeviceToken::label()` builds a combined label (e.g. **"Pixel 7 · Android 14"**), surfaced as `device_label` on `DriverResource` (eager-loaded via `Driver::latestDeviceToken`) and shown as a muted line under the "On app" badge on the drivers panel. **Ships OTA** — pure JS/TS, no native rebuild.
- **2026-09-02 — Uber "Fleet Hub" host migration.** Uber renamed `supplier.uber.com` → `fleethub.uber.com` (roster + live-status APIs; the offer RAMEN host `vsdispatch.uber.com` is unchanged). Migrated everywhere: `config/services.php` `uber.supplier_base_url` default → `https://fleethub.uber.com` (env `UBER_SUPPLIER_BASE_URL`), `UberSupplierClient`, `dispatch-daemon` `config.uberSupplierBase`, the extension (`manifest.json` content-script match + all `background.js` fetches + `inject.js` `onSupplier` host regex now allow both `supplier|fleethub`), and the frontend connect/reconnect links. Extension bumped to **1.15.4**. If status sync silently dies (offers still flow, map empty, all offers show "Not taken") suspect a missed host ref.
- **2026-09-02 — `fleet:check-sync` sync-breakage detector.** `App\Console\Commands\CheckFleetSync` (scheduled every 5 min) logs `fleet.sync_stale` for active companies that have linked drivers but no fresh `status_synced_at` (`STALE_MINUTES = 12`) — i.e. offers arrive but the status poll is broken (the failure mode the Fleet Hub migration caused). See it on the System Health page.
- **2026-09-02 — Daemon self-heals after a reconnect (no manual restart).** The supervisor fingerprinted each session's cookie jar by **count**, so a re-link that rotated the token to a new value with the same count went undetected → the stream kept the dead cookies and RAMEN-404'd until someone restarted the daemon. Now fingerprinted by **value** via the shared `jarFingerprint()` (`dispatch-daemon/src/stream.js`, imported by `index.js`) — a reconnect restarts the stream on its own. Stable between reconnects, so it doesn't churn.
- **2026-09-02 — Geocode-before-notify + multi-stop detail.** `TripGeocoder::enrichForNotify()` runs a **bounded (~2.5 s, deadline-guarded)** pre-push geocode so the FCM push carries distance/€-per-km instead of arriving bare (offers were pushing before the async enrich ran). Multi-stop rides now resolve per-leg: `labelStops()` reverse-geocodes each waypoint with `leg_m`/cumulative distance, surfaced in `DispatchOfferResource` as `stops_count` + `stops[]` (dashboard + driver app render per-stop detail). A scheduled `queue:work --stop-when-empty` (below) drains the async `GeocodeOffer`/`SyncTripFromWaypoints` jobs.
- **2026-09-02 — Queue draining (dedicated `queue` container + scheduler backstop).** Prod queue = **database**. Prod runs a dedicated **`queue` container** (`php artisan queue:work --queue=default --tries=3 --backoff=10 --max-time=3600`) that is the primary worker; `backend/routes/console.php` ALSO schedules a `queue:work --stop-when-empty --max-time=50` every minute as a belt-and-suspenders backstop (covers a dead worker), plus `offers:backfill-geo` every 10 min, `fleet:check-sync` every 5 min, and a scheduler heartbeat for the infra-health check. The `scheduler` (`schedule:work`) and `queue` containers must both be up. **A stale anonymous `vendor` volume once shadowed a rebuilt image and crash-looped the scheduler (`ReverbServiceProvider not found`); the deploy uses `--renew-anon-volumes` to prevent this.**
- **2026-09-02 — Admin System Health: infrastructure, queue, logs.** `app/Domain/System/InfrastructureHealthService.php` reports queue depth, scheduler heartbeat, and TCP/HTTP reachability of Reverb/Nominatim/OSRM. `Admin/QueueAdminController` (failed / retry / flush / clearPending) and `Admin/LogViewerController` (tail + clear `laravel.log` and a frontend log; frontend errors POST in via `client-error-reporter`) power new tabs on the System Health page — order: **health · services · logs · shards**.
- **2026-09-02 — Driver-app date picker.** The Statistics/Offers period pill gained a **"Pick a date"** row that swaps in a self-contained month calendar (day/month/year; future days disabled). A picked day maps to `range="today"` + its day-offset, so all downstream windows/charts/queries are unchanged. Pure JS/RN — **no native module, ships OTA**. Lives in `driver-app/src/components/period-navigator.tsx`.

---

## How to work on this project (agent operating guide — start here)

You are picking up a live production system. Work like the maintainer, not a prototyper: keep changes **scoped**, respect the invariants below, verify before you commit, and leave this file current.

### The loop for every task

1. **Orient.** Read the change log above, then `git log --oneline -20`. Grep for the feature you're touching before writing — reuse the existing service/helper (the architecture is service-layered; see §4).
2. **Locate.** Use the task map below to jump to the right files. Business logic lives in `app/Domain/**`, never in controllers.
3. **Change the smallest surface.** Don't re-architect a settled subsystem to fix a bug (see Invariants). If the fix implies a design change, confirm with the user first.
4. **Verify** with the gate for the surface you touched (table below). Never commit a surface you didn't build/type-check.
5. **Commit** with a Conventional Commit (`fix(daemon): …`, `feat(driver-app): …`, `docs: …`), body explaining *why*, and the `Co-Authored-By: Claude …` trailer. Work happens **directly on `main`** in this repo.
6. **Update this file** — add a dated change-log line (and fix any section your change made stale) **in the same commit**. Then `git push origin main`. A change isn't done until the guide reflects it and it's pushed.

### Verification gates (run before committing that surface)

| You touched… | Gate |
| --- | --- |
| `backend/` | `cd backend && vendor/bin/pint --test && php artisan test` (sqlite `:memory:`). CI runs the same on PHP 8.4. |
| `frontend/` | `cd frontend && npm run build` (the hard gate; lint is advisory). Read `node_modules/next/dist/docs/` first — Next 16 ≠ training data (see Gotchas). |
| `driver-app/` | `cd driver-app && npx tsc --noEmit` (the `lint` script). |
| `dispatch-daemon/` | `node -c src/<file>.js` on each changed file (ESM, no build step). |
| `extension/` | Load unpacked in Chrome and check the console; bump `manifest.json` `version` for any store release. |

### Deploy model (what a change actually needs to ship)

| Surface | How it reaches prod |
| --- | --- |
| `backend/` | **Volume-mounted** — a `git pull` on the VPS + `migrate --force` + `config:clear` + `restart backend scheduler queue`. No image rebuild. `.github/workflows/deploy.yml` does this on push to `main` (it auto-runs `migrate --force`). See §6. |
| `frontend/` / `dispatch-daemon/` | Built into images → `docker compose -f docker-compose.prod.yml up -d --build <service>`. |
| `driver-app/` | **Prefer OTA** (`eas update`) — no store review. A change needs a **native rebuild** (`eas build`) only when it adds/updates a native module or changes `app.json` native config. Pure JS/TS/RN changes ship OTA. Call this out in the change log (the date picker did). |
| `extension/` | Chrome Web Store (unlisted, auto-update). Bump `manifest.json` version, zip `extension/`, upload; users update automatically. |

### Task map — "I want to…" → files

| Goal | Touch |
| --- | --- |
| Add a field to the **offer push** | `DispatchNotifier` (payload/title/body) → `DispatchOfferResource` (dashboard/app JSON) → driver-app `offer-card`/`offer/[id]` + `frontend` offer views. |
| Change **acceptance/lifecycle inference** | `Domain/Fleet/DriverStatusIngestor.php` (edges) + `Domain/Dispatch/OfferLifecycle.php` (guarded transitions). **Status-based inference only** — do not reintroduce a timeline reconciler (it was tried and reverted). |
| Tune **geocoding / distance / addresses** | `Domain/Dispatch/TripGeocoder.php` (tiers, viewbox bias, `enrichForNotify`, `labelStops`, OSRM legs). Respect the city rule (Invariants). |
| Add a **driver-app string** | `driver-app/src/lib/i18n.ts` — add the key to **all three** de/en/ar blocks. |
| Add a **dashboard string** | `frontend/src/lib/i18n/` (`dictionaries.ts` for chrome, `screens-*.ts` for screens) — all three locales; watch for a duplicate key matching an earlier block. |
| Add a **scheduled job / cron** | `backend/routes/console.php` (the scheduler container runs `schedule:work`). |
| Add an **admin health/queue/log signal** | `Domain/System/InfrastructureHealthService.php`, `Admin/QueueAdminController`, `Admin/LogViewerController` → System Health tabs (`frontend/.../admin/system-health`). |
| A **new tenant-owned table** | model uses `BelongsToTenant`; remember the global scope is silent in console/daemon contexts (Gotchas). |
| **Daemon stream/session logic** | `dispatch-daemon/src/{index.js (supervisor),stream.js (RamenStream + jarFingerprint),config.js,api.js}`. |

### Invariants — do NOT change these without explicit confirmation

These are settled product rules. Treat a request that seems to break one as a misunderstanding to clarify, not an instruction to execute.

- **Observe, don't control.** Never accept/reject/start/end a trip or message a rider. Acceptance is inferred from Uber status only. (See §1.)
- **Time model.** Timezone is **Europe/Berlin**; the **week starts Monday**; the **Uber fleet-day starts at 04:00**. All stats/windows use fleet-days.
- **Every offer push must carry** distance + dropoff + €/km with the €-quality badge. Geocode **before** notifying (`enrichForNotify`) so the push is never bare. A **multi-stop** ride pushes a new notification and shows per-stop addresses + per-leg km on both dashboard and app.
- **Addresses.** Maximize geocoding; correct addresses from Uber waypoints after acceptance; **never change the city wrongly** — an authoritative city/PLZ must win over a mis-biased reverse-geocode.
- **i18n & numerals.** German is the **default** language (de/en/ar everywhere, RTL for ar). Money/distance/dates always render **Latin digits**, even in Arabic (`format.ts` / `latnLocale()`).
- **Scope discipline.** Keep bug fixes narrow; don't refactor working fundamentals to land a small fix.
- **Idempotency.** Offer ingest (on `offer_uuid`) and lifecycle transitions are idempotent by design — re-delivery from daemon/extension is expected and safe.

> **Sensitive/intentional:** a fixed **OTP test code** path exists (`services.otp_test_code` / `OTP_TEST_CODE`) so the team can log into the driver app without a live SMS — it is intentional; leave it unless the user says otherwise. Product posture is DSGVO "**detect, don't surveil**": don't add data collection beyond what a feature needs without flagging it.

---

## 1. Mental model

**What Reidey does.** German Uber-fleet operators run many drivers under one Uber "org". Uber sends ride **offers** to drivers with only a ~5-second accept window. Reidey taps the fleet's own **live Uber dispatch stream** (Uber's internal "RAMEN" server-sent-events feed), figures out which of the fleet's drivers each offer is for, and instantly pushes it to that driver's phone with the fare, €-quality, addresses and distance — so the driver can decide fast.

**The one principle: observe, don't control.** Reidey never accepts, rejects, starts, or ends a trip. It only *watches* Uber:

- **Offers** come in on the RAMEN stream (push).
- **Trip state** is *inferred*, never commanded. The daemon polls each driver's live Uber engagement status (~10s). When a driver goes idle → EN_ROUTE we infer "accepted"; → ON_TRIP is "started"; back to idle is "completed/canceled". The offer lifecycle is a read-only mirror of what the driver did inside the Uber app.

Keep this principle when extending the product. Anything that would *act on* Uber (auto-accept, cancel, message a rider) is out of scope and legally/ToS dangerous.

**Why the odd plumbing.** Uber blocks datacenter IPs (RAMEN 404s, roster returns 0). So the stream is held either server-side through a **residential proxy** (the `dispatch-daemon`), or in the **manager's own browser** via a Chrome extension (real residential IP). Both are just *capture* transports; the Laravel backend is the brain and single source of truth.

**Naming note.** The product is **Reidey** (domain `reidey.de`). You will see legacy names in code/comments/docs — `Ridy`, `DASHCAM`, `fleeteye`. They refer to the same system across its rename history.

---

## 2. Architecture deep-dive

### 2.1 Offer pipeline (capture → ingest → match → geocode → push)

**Transport in.** The daemon posts raw offer batches to:

```
POST /api/v1/internal/dispatch/ingest      header: X-Dispatch-Secret: <DISPATCH_INGEST_SECRET>
```

Guarded by the `dispatch.secret` middleware. Body: `{ offers: [...], seq?: int }`. There is a *second*, user-session-authenticated path used by the browser extension: `POST /api/v1/dispatch/offers/ingest` (`DispatchOfferController@ingest`).

**Key files/classes:**

| Concern | File / class |
| --- | --- |
| Internal ingest endpoint | `backend/app/Http/Controllers/Api/V1/DispatchIngestController.php` |
| Secret middleware | `backend/app/Http/Middleware/VerifyDispatchSecret.php` (alias `dispatch.secret`, `hash_equals` on `X-Dispatch-Secret` vs `services.dispatch.ingest_secret`) |
| Core ingestor | `backend/app/Domain/Dispatch/DispatchOfferIngestor.php` |
| Geocoding | `backend/app/Domain/Dispatch/TripGeocoder.php` |
| Driver push builder | `backend/app/Domain/Notifications/DispatchNotifier.php` |

**Flow (`DispatchOfferIngestor::ingest($tenantId, $offer, $seq)`):**

1. The daemon never knows internal tenant IDs — the controller resolves the tenant by `Tenant::where('uber_org_uuid', $offer['partnerUUID'])`. No match → `no_tenant`.
2. Idempotent on `offer_uuid` (unique `(tenant_id, offer_uuid)` index; also catches the `QueryException` race) → `duplicate`; empty uuid → `skipped_no_uuid`.
3. Driver match: `Driver::where('uber_driver_uuid', $offer['driverInfo']['driverUUID'])`. Stored with `status = OfferStatus::Pending`. Fare parsed from `formattedUFP` via `DriverStatsService::parseFare`.
4. If a driver is linked: `TripGeocoder::enrich($record)` then `DispatchNotifier::notify($record)`, each in its own try/catch — a geocode or push failure never loses the offer. Result is `routed` (driver linked) or `unlinked_driver`.

**Geocoding (`TripGeocoder`).** Constants: `NOMINATIM = https://nominatim.openstreetmap.org/search`, `OSRM = https://router.project-osrm.org/route/v1/driving`, `MAX_ATTEMPTS = 5`, 6s HTTP timeout, custom `UA`. Geocodes pickup + dropoff (results cached in the `geocode_cache` table keyed by query; transient 429/5xx/timeout are *not* cached so they retry). Both ends resolved → OSRM route → `distance_m` + `route_geometry` (GeoJSON) + stamps `geo_synced_at`. OSRM down → haversine straight-line distance, no geometry. Gives up after 5 attempts. The `offers:backfill-geo` scheduled command retries offers whose lazy enrich failed.

**Push (`DispatchNotifier`).** Deliberately *data-only / language-neutral* (the phone localizes). Sends to every `DeviceToken` of the linked driver via the injected `PushSender`.
- **Title** (`buildTitle`): `"5.85 €€ | Peter"` — fare (`number_format(…, 2)`) + €-quality + `" | " + rider_first_name`.
- **€-quality** (`euroSigns`) by per-km rate `fare/km`: `>= 3 → €€€`, `> 1 → €€`, else `€`. Unknown fare/km → single `€`.
- **Body** (`buildBody`): `pickup \n --> \n dropoff`, plus a metrics line `"12.3 km · €1.26/km"` when distance is known. Addresses cleaned of trailing country (`cleanAddress`).
- Data payload: `offer_id, offer_uuid, pickup, dropoff, fare, fare_amount, distance_m, accept_window, received_at`.

### 2.2 Offer lifecycle (inference + guarded transitions)

**Enum** `backend/app/Domain/Dispatch/OfferStatus.php`: `Pending, Accepted, Started, Completed, Rejected, Canceled`.

**Guarded transitions** (`allowedNext()`):

```
Pending   → Accepted | Rejected
Accepted  → Started  | Canceled
Started   → Completed
Rejected  → Accepted            (late-detected accept overturns a premature timeout)
Completed → (terminal)
Canceled  → (terminal)
```

`OfferLifecycle` (`backend/app/Domain/Dispatch/OfferLifecycle.php`) runs every transition inside a DB transaction with `lockForUpdate()`; a disallowed transition is a **no-op** (idempotent). Constants:
- `ATTRIBUTION_MINUTES = 15` — a stale offer older than this isn't attributed to a new engagement.
- `ACCEPTED_STALE_MINUTES = 20` — ACCEPTED-but-never-started is force-canceled after this.
- `MAX_TRIP_MINUTES = 100` — a STARTED offer open longer is force-completed (the over-long-trip safety net).

**Inference** (`backend/app/Domain/Fleet/DriverStatusIngestor.php`). Engagement `level()`: string contains `ON_TRIP` → 2, `EN_ROUTE` → 1, else 0 (idle). Edge rules (`applyTransition`):
- idle → engaged: find the pending offer → `accept()`. If it jumped straight to ON_TRIP, also `start()`.
- EN_ROUTE → ON_TRIP: active offer → `start()`.
- ON_TRIP → EN_ROUTE (back-to-back): `complete()` the started offer, then `accept()` the next takeable offer newer than it.
- engaged → idle: `complete()` if Started, else `cancel()` if Accepted.

Uber's 0,0 coords are nulled; malformed rows are per-row try/catch so one bad row never fails a batch. After each batch it runs `expirePending()` (Pending → Rejected once `received_at + accept_window + 30s` elapses) and `finalizeStale()`.

**Safety nets (scheduled).** `offers:finalize-stale` (`App\Console\Commands\FinalizeStaleOffers`, every 5 min) force-completes STARTED offers older than 100 min and force-cancels ACCEPTED older than 20 min, across all tenants (covers idle daemons). `offers:expire-pending` (every minute) is the idle-tenant backstop for the accept window.

### 2.3 Driver-app auth (two guards)

Sanctum with **two guards** (`backend/config/auth.php`): `web` (session/`users`, the SPA dashboard) and `driver` (**sanctum bearer** / `drivers` provider → `App\Domain\Fleet\Models\Driver`, which has `HasApiTokens`).

**Invite → activate flow** (`backend/app/Domain/Fleet/DriverInvitationService.php`, `INVITE_TTL_DAYS = 7`):
1. Manager invites: `POST /api/v1/drivers/{driver}/invite` (`DriverInviteController@send`). Recipient = `driver.email`, falling back to `driver.uber_email`. Sets `invite_token = Str::random(48)`, `invited_at`, emails template `driver_invite` with a link `{frontend_url}/driver/activate?token=…`.
2. Driver activates within 7 days: `POST /api/v1/driver/activate` sets the password, stamps `activated_at`, clears the token, and `createToken('driver-app')` issues the Sanctum bearer.
3. Driver-app auth controller: `backend/app/Http/Controllers/Api/V1/Driver/DriverAuthController.php` (`invite` preview, `activate`, `login`, `me`, `update`, `logout`).

**Subscription gate.** `backend/app/Http/Middleware/EnsureDriverTenantActive.php` (alias `driver.active`) reads `user->tenant->stateReason()`; if non-null it returns `403 { message: 'account_suspended', reason, support_email, support_whatsapp }`. Applied to the driver's data routes (`me`, `devices`, `home`, `stats`, `offers`), so a driver of a lapsed company is blocked even with a valid token. `DriverAuthController::guardSuspended()` also blocks login/activate.

### 2.4 Notifications (bell + web push + email)

`backend/app/Domain/Notifications/Notifier.php` is the **single place** dashboard notifications are created. For each recipient it:
1. Writes a typed `AppNotification` (database channel — stores `{type, params, href}`, *not* rendered text, so the frontend localizes).
2. If the user opted in for that category: sends **FCM web push** to each `UserPushToken`, and a **localized email** (`SendTemplatedMail` template `notification`, CTA localized via `OPEN_LABEL` de/en/ar).

Recipient resolvers: `toTenant($tenantId, …)` (all of a company's users), `toAdmins(…)` (`User::role('super_admin')`), `toUser($user, …)`. Flags: `dedupe` (skip if an unread of the same type exists), `push:false` (bell-only, used for high-frequency offer events).

**Preference gating.** `CATEGORIES = ['sessions','subscription','platform','codes']`. `User::wantsChannel($channel, $category)` is opt-out (true unless explicitly false), stored on `users.notification_prefs` (array cast). `admin_broadcast` is **forced** — it ignores prefs and is never shown as a toggle.

**Notification types** (from `NotificationPushText::MAP` + `TYPE_CATEGORY` + call sites):

| Type | Category | Emitted by |
| --- | --- | --- |
| `session_connected` | sessions (bell-only, email-skipped) | `FleetSessionService` |
| `session_needs_relink` | sessions | `FleetSessionService` |
| `company_registered` | platform | `RegistrationController` |
| `company_banned` | platform | activation/ban flow |
| `proxy_expiring` | platform | `ScanNotifications` |
| `subscription_activated` | subscription | `CompanyActivationController` |
| `subscription_free` | subscription | `Admin/SubscriptionController` |
| `subscription_expiring` / `subscription_expired` | subscription | `ScanNotifications` (dedupe) |
| `code_activated` | codes | code activation |
| `admin_broadcast` | broadcast (forced) | `SendAdminBroadcast` job |

**Localized copy:** `backend/app/Domain/Notifications/NotificationPushText.php` (de/en/ar title+body with `{param}` interpolation; unknown types fall back to a generic "Reidey").
**Admin broadcast:** `backend/app/Jobs/SendAdminBroadcast.php` (queued, chunks 200, per-recipient failures swallowed), dispatched from `Admin/AdminNotificationController@broadcast` (`POST /api/v1/admin/notifications/broadcast`).
**API:** `backend/app/Http/Controllers/Api/V1/NotificationController.php` — `index` (latest 50 + unread meta), `markRead`, `destroy`, `clear`, `registerDevice`/`unregisterDevice` (web token). Prefs: `NotificationPrefsController` (`GET/PUT /api/v1/notification-prefs`).

### 2.5 Tenancy & billing

**Multi-tenancy.** `backend/app/Domain/Tenancy/Concerns/BelongsToTenant.php` adds the `TenantScope` global scope (`TenantScope.php`: `where tenant_id = context->get()`, no-op when no tenant is set) and auto-fills `tenant_id` on create. The active tenant lives in the `TenantContext` singleton, set by `backend/app/Http/Middleware/ResolveTenant.php` from the authenticated user (`super_admin` with no tenant passes through cross-tenant; any other tenant-less user → `403 no_tenant`).

**Roles/permissions** (Spatie, seeded in `database/seeders/RolePermissionSeeder.php`): roles `super_admin`, `owner`, `fleet_manager`, `driver`, `viewer`, `reseller`; permissions include `offers.view, drivers.manage, connections.manage, audit.view, users.manage, companies.manage, companies.users.manage, companies.sessions.manage, platform.view, codes.generate`. Super-admin guard: `EnsureSuperAdmin` (alias `super.admin`).

**Billing.** Activation codes (`app/Domain/Billing/Models/SubscriptionCode.php`, `status() = pending|activated|expired`), plans + periods (`Plan`, `SubscriptionPeriod`), company activation `POST /api/v1/company/activate` (3 tries → ban), history `GET /api/v1/subscription/history`. Collectors/resellers are **platform-level** (not tenant-scoped): `app/Domain/Collections/Models/{Collector,CollectorPayment}.php`, resellers issue codes via `/api/v1/reseller/*`.

**Proxy pool.** `app/Domain/Tenancy/Models/Proxy.php` — `capacity` (int) counts **company slots**; `usedCount()` = usable tenants on that proxy; `hasFreeSlot()`. `app/Domain/Tenancy/ProxyPool.php::assign()` keeps a tenant's current proxy if it has a slot, else moves to the least-loaded proxy with capacity, else falls back to the global proxy. (The "capacity in drivers" framing maps to per-company slots in code.)

**System health.** `app/Domain/Tenancy/SystemHealthService.php::report()` → one row per tenant with subscription state/days-left, Uber session freshness, daemon heartbeat (`HEARTBEAT_TTL_MINUTES = 5`), and proxy status, sorted by severity. Exposed at `GET /api/v1/admin/system-health`.

### 2.6 FCM (driver push + web push, same Firebase project)

| Concern | File |
| --- | --- |
| Sender (HTTP v1) | `backend/app/Domain/Notifications/Push/FcmPushSender.php` |
| OAuth2 token | `backend/app/Domain/Notifications/Push/GoogleServiceAccountToken.php` |
| Binding | `backend/app/Providers/AppServiceProvider.php` |
| Config | `backend/config/services.php` (`fcm.credentials`, `fcm.project_id`) |

`FcmPushSender` POSTs to `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send` with a bearer minted by `GoogleServiceAccountToken` (self-signed RS256 JWT, scope `firebase.messaging`, exchanged for an access token cached ~55 min — no Firebase SDK). `AppServiceProvider` binds `PushSender` → `FcmPushSender` **only if** the `FCM_CREDENTIALS` file exists on disk; otherwise it binds `LogPushSender` (pushes are logged, not sent). `projectId` comes from `FCM_PROJECT_ID` or the JSON's `project_id`.

The **dashboard web push** uses the *same* Firebase project — config is baked into `frontend/src/lib/push/web-push.ts` (project `reidey-225e8`, plus a hard-coded VAPID key). The service worker is `/firebase-messaging-sw.js`; tokens register at `POST /api/v1/notifications/device`.

> ⚠️ **Prod FCM is not fully wired.** `docker-compose.prod.yml` and the deploy workflow only pass `FCM_SERVER_KEY` (a legacy key), *not* `FCM_CREDENTIALS` / `FCM_PROJECT_ID`, and mount no service-account JSON. So on prod the backend falls back to `LogPushSender` and driver push is only logged. To enable it: place the service-account JSON in the backend container, set `FCM_CREDENTIALS`/`FCM_PROJECT_ID`, and redeploy. See §6.

---

## 3. Data model

Tenant-owned tables carry `tenant_id` and use `BelongsToTenant`. Key tables/models:

| Table | Model | Key columns / relationships |
| --- | --- | --- |
| `tenants` | `Domain\Tenancy\Models\Tenant` | `name, status, country, settings, uber_org_uuid, proxy_url, proxy_id, activated_at, subscription_ends_at, banned_at`, activation fields. `stateReason()`, `isUsable()`, `daysLeft()`. Matched to offers by `uber_org_uuid`. |
| `users` | `App\Models\User` | dashboard users; `tenant_id`, `locale`, `notification_prefs` (array), Spatie roles, `HasApiTokens`. |
| `drivers` | `Domain\Fleet\Models\Driver` | `tenant_id, uber_driver_uuid, name, email, uber_email, password, invite_token, invited_at, activated_at`. Auth provider for the `driver` guard. |
| `dispatch_offers` | `Domain\Dispatch\Models\DispatchOffer` | `tenant_id, driver_id, offer_uuid` (unique per tenant), `status` (OfferStatus), fare fields, `pickup/dropoff`, `distance_m, route_geometry, geo_synced_at, geo_attempts`, `accept_window_seconds, received_at, accepted_at, started_at`. |
| `geocode_cache` | — | cached Nominatim results keyed by `query`. |
| `proxies` | `Domain\Tenancy\Models\Proxy` | `label, url` (hidden/encrypted), `capacity, price, source, expires_at`. |
| `device_tokens` | `Domain\Notifications\Models\DeviceToken` | **driver app** FCM tokens: `tenant_id, driver_id, token, platform, device_name, os_version, last_used_at`. `device_name`/`os_version` (nullable, from expo-device) yield `label()` (e.g. "Pixel 7 · Android 14") for the dashboard. Consumed by `DispatchNotifier`. |
| `user_push_tokens` | `Domain\Notifications\Models\UserPushToken` | **dashboard web push** tokens: `user_id, token, platform, last_used_at`. Consumed by `Notifier::webPush()`. |
| `subscription_codes` | `Domain\Billing\Models\SubscriptionCode` | `code, plan_id, tenant_id, collector_id, amount, paid, expires_at, activated_at`. |
| `plans`, `subscription_periods` | `Plan`, `SubscriptionPeriod` | billing plans and active periods. |
| `collectors`, `collector_payments` | `Domain\Collections\Models\*` | platform-level (not tenant-scoped). |
| notifications (Laravel default) | — | in-app bell; `data->type`, `data->params`, `data->href`. |
| email templates | (email-template model/controller) | admin-editable localized templates; rendered by `EmailTemplateRenderer`, sent by `SendTemplatedMail`. |

Fleet session (the captured Uber session) is stored on the backend and served to the daemon via `GET /api/v1/internal/dispatch/sessions` (carries `id, tenant_id, uber_org_uuid, cookies, supplier_cookies`).

---

## 4. Conventions

**Service-layer architecture.** Thin controllers → services (`app/Domain/**`) → models/repositories. Business logic lives in the domain services (`DispatchOfferIngestor`, `OfferLifecycle`, `DriverStatusIngestor`, `Notifier`, `DriverInvitationService`, `ProxyPool`, `SystemHealthService`, …), not controllers. Dependencies are injected (e.g. `PushSender` is an interface bound in `AppServiceProvider`).

**i18n.** Three languages everywhere: **de / en / ar**, and **German is the default**.
- Frontend keys live in `frontend/src/lib/i18n/` — chrome/nav in `dictionaries.ts`, per-screen strings split across `screens-a.ts`, `screens-b.ts`, `screens-ridy.ts`, `screens-admin.ts` (merged under `screens.*`). Add a key to **all three** locales.
- Driver app: `driver-app/src/lib/i18n.ts` (flat dot-key dictionaries).
- **RTL** for Arabic: `RTL_LOCALES = ["ar"]`, sets `dir="rtl"` + `lang` on `<html>`.
- **Money = Latin digits always, one fixed shape.** Even in Arabic, prices/distances/dates render Western numerals. Frontend uses `latnLocale()` → `"ar-u-nu-latn"` and `toLatinDigits()` (`frontend/src/lib/utils.ts`). The driver app (`driver-app/src/lib/format.ts`) formats **money + distance in `de-DE`** — one canonical German shape everywhere: fare `"4,10 €"`, rate `"1,77 €/km"`, distance `"2,3 km"` (comma decimal, € **after** the amount, Latin digits) — and time in `en-DE` (`"02/09, 11:12"`). It formats from the **numeric** amount and never Uber's pre-formatted string (which mixed `"EUR"`/`"€"` and flipped the symbol side — the old inconsistency).

**Theme tokens.** Tailwind v4 CSS-first, no `tailwind.config.js`. Semantic tokens are CSS vars in `frontend/src/app/globals.css` on `:root` (light) / `.dark` (dark), exposed via `@theme inline` (`bg-surface`, `text-ink`, `border-line`, status tones `success/danger/warning/info/accent`). Dark mode is class-based (`@custom-variant dark`). Never hard-code hex — use the token utilities. The driver app mirrors this via a `useColors()` hook (`driver-app/src/lib/theme.ts`) returning a light/dark palette, including offer-status hues.

**Testing patterns.** Feature tests under `backend/tests`, run on sqlite `:memory:`. For notifications/mail use `Mail::fake()` or the array transport; for push, bind a spy/fake `PushSender` (the interface makes this clean — `LogPushSender` is the no-op default when FCM creds are absent). Run `vendor/bin/pint --test` for style and `php artisan test`. Frontend gate is `npm run build`; lint is advisory (React 19 hook rules flag legacy patterns).

---

## 5. Environment / config

Read `.env.example` (dev compose), `.env.prod.example` (prod compose), and `backend/.env.example` (Laravel). Important keys:

| Key | Where | Purpose |
| --- | --- | --- |
| `APP_KEY` | all | Laravel app key (`php artisan key:generate --show`). |
| `DB_CONNECTION` / `DB_*` | backend | `sqlite` local; `mysql` + `DB_HOST=mysql` in compose. Prod DB name `ridy`. |
| `DISPATCH_INGEST_SECRET` | backend + daemon | shared secret for `X-Dispatch-Secret`. **Must match** on both sides. |
| `FCM_CREDENTIALS` | backend | path to Google service-account JSON. File must exist or push is logged only. |
| `FCM_PROJECT_ID` | backend | Firebase project id (falls back to JSON `project_id`). |
| `FRONTEND_URL` → `app.frontend_url` | backend | base for activation links + email CTAs (prod: `https://${DOMAIN}`). |
| `MAIL_*` | backend | mailer (dev default `log`). |
| `SANCTUM_STATEFUL_DOMAINS`, `SESSION_DOMAIN` | backend (prod) | SPA cookie auth for the dashboard. |
| `UBER_PROXY_URL` | daemon | residential proxy (`http://user:pass@host:port` or `socks5://…`); global fallback. |
| `UBER_DISPATCH_BASE_URL` | daemon | offer RAMEN host, default `https://vsdispatch.uber.com` (unchanged by the Fleet Hub rename). |
| `UBER_SUPPLIER_BASE_URL` | backend + daemon | roster/live-status host, default `https://fleethub.uber.com` (was `supplier.uber.com` before the Sep-2026 migration). |
| `UBER_RAMEN_PATHS` | daemon | default `/ramendca/events,/ramenphx/events`. |
| `RIDY_API_URL` | daemon | backend base (prod: `https://${DOMAIN}` via Caddy hairpin). |
| `STATUS_INTERVAL_MS` / `ROSTER_INTERVAL_MS` / `SESSION_POLL_INTERVAL_MS` | daemon | 10s / 30min / 60s defaults. |
| `NEXT_PUBLIC_API_URL` | frontend build | API base for the browser. |

> Per-company proxies are stored in the DB (`proxies.url`, encrypted), not env; `UBER_PROXY_URL` is only the global fallback.

---

## 6. Deployment (prod: Docker Compose + Caddy on one VPS)

Prod stack `docker-compose.prod.yml` (domain `reidey.de`). Services:

| Service | What |
| --- | --- |
| `caddy` | TLS edge + reverse proxy (auto Let's Encrypt). Given a network alias of `${DOMAIN}` so the daemon reaches the API by public domain over the internal network (VPS hairpin fix). |
| `mysql` | MySQL 8, volume `dbdata`, healthcheck. |
| `backend` | Laravel PHP-FPM. **`./backend` is volume-mounted** (`:/var/www` + anonymous `/var/www/vendor`) — so a deploy is a code sync, not an image rebuild. |
| `scheduler` | same image, `command: php artisan schedule:work` — runs Laravel's cron in one long process (no host crontab). |
| `queue` | same image, `command: php artisan queue:work --queue=default --tries=3 --backoff=10 --max-time=3600` — the primary queue worker (the scheduler's per-minute `queue:work --stop-when-empty` is a backstop). |
| `reverb` | Laravel Reverb WebSocket server (broadcasting) — the driver app subscribes for live offer updates; the dashboard still polls. |
| `frontend` | Next.js, built with `NEXT_PUBLIC_API_URL=https://${DOMAIN}`. |
| `dispatch-daemon` | Node RAMEN daemon; env `RIDY_API_URL=https://${DOMAIN}`, `DISPATCH_INGEST_SECRET`, `UBER_*`. |
| `nominatim`, `osrm` | optional self-hosted geocoding/routing (behind the `geo` profile — see `docs/self-hosted-geo.md`); `TripGeocoder` falls back to the public OSM services when unset. |

Backend, scheduler and queue share env via the `x-app-env` YAML anchor (prod uses **database** queue/cache; no Redis/Horizon — those are dev-only in `docker-compose.yml`).

**First-time provision** (see `docs/13-deployment.md`): DNS A record → install Docker → clone → `cp .env.prod.example .env` and fill `DOMAIN`, DB passwords, `DISPATCH_INGEST_SECRET` → generate `APP_KEY` → then:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend php artisan migrate --force --seed
# seed creates manager@fleet.de / password — change it immediately.
```

**Routine deploy** (backend is mounted, so no image rebuild for backend/scheduler):

```bash
git pull
docker compose -f docker-compose.prod.yml exec backend php artisan migrate --force
docker compose -f docker-compose.prod.yml exec backend php artisan config:clear
docker compose -f docker-compose.prod.yml restart backend scheduler queue
```

**Frontend / daemon changes** (built into images) need a rebuild:

```bash
docker compose -f docker-compose.prod.yml up -d --build frontend
docker compose -f docker-compose.prod.yml up -d --build dispatch-daemon
```

> The CI deploy workflow (`.github/workflows/deploy.yml`) automates an SSH deploy on push to `main`: `git reset --hard origin/main`, `up -d --build`, `migrate --force`, then `config:cache` (note: it runs `config:cache`, not `config:clear` — clear it manually if you're debugging config).

**FCM in prod.** To actually send driver push (not just log it): copy the Firebase service-account JSON into the backend container/volume, set `FCM_CREDENTIALS=<path-inside-container>` and `FCM_PROJECT_ID` in `.env` (and pass them through `x-app-env` in the compose file), then `config:clear` + `restart backend scheduler`. Until then, `AppServiceProvider` binds `LogPushSender`. Web push is independent and already configured in the frontend bundle.

**Uber linking on prod.** Automated server login is blocked (datacenter IP). The manager installs the Chrome extension, logs into Uber in their own browser, the session is captured (`POST /api/v1/fleet-session`), and the daemon picks it up automatically.

---

## 7. Driver-app build & release

- **Stack:** Expo SDK 52, Expo Router (`app/`), React Native 0.76, `expo-notifications` (FCM), `expo-secure-store` (bearer token). Design handoff + screen mockups: `driver-app/README.md` and `driver-app/screens/*.png` (light, dark, RTL, empty/loading/permission/subscription-lapsed states). *(There is no `driver-app/HANDOFF.md`; the README is the handoff.)*
- **Config** (`driver-app/app.json`): `scheme: "reidey"` (deep link `reidey://`), `android.package: de.fleeteye.reidey.driver`, `googleServicesFile: ./google-services.json`, `extra.apiUrl: https://reidey.de`, `extra.eas.projectId`.
- **FCM needs a dev/production build, not Expo Go.** Drop `google-services.json` (Android) / `GoogleService-Info.plist` (iOS) into `driver-app/` (git-ignored). Local dev build: `npx expo run:android`.
- **EAS build** (`driver-app/eas.json`): profiles `preview` (internal, APK), `development` (dev client, APK), `production` (app-bundle, auto-increment). Preview APK:
  ```bash
  eas build -p android --profile preview
  ```
- **Deep link.** The invite email links to `https://reidey.de/driver/activate?token=…` (the frontend `/driver/activate` landing page). Test the scheme with `npx uri-scheme open "reidey://activate?token=XYZ" --android`.

---

## 8. Runbook (diagnosing common issues)

**Offers not arriving at all.**
- Check the daemon logs (`docker compose -f docker-compose.prod.yml logs -f dispatch-daemon`). Look for `starting stream …`, `stopping stream …`, `session poll failed`.
- Is there an active fleet session? `GET /api/v1/internal/dispatch/sessions` (with the secret) should list it. If the manager never linked, or the session flipped to `needs_relink` (Uber returned 401/403), no stream runs — the manager must re-link via the extension.
- **Proxy**: a company with no proxy (and no global `UBER_PROXY_URL`) connects directly → Uber blocks it (RAMEN 404, roster 0). Assign a proxy in the admin panel; the daemon restarts that stream automatically.
- **After a re-link**: the supervisor now fingerprints cookies by value (`jarFingerprint`), so a reconnect restarts the stream on its own — a manual daemon restart should no longer be needed. If a re-link still doesn't take effect, check the daemon logs for `stopping stream … (cookies changed)` then `starting stream …`.
- Verify `DISPATCH_INGEST_SECRET` matches on both sides (mismatch → 401 on `/ingest`).

**Our data disagrees with Uber (offer stuck / wrong lifecycle state).**
- This is inference, so it's the `DriverStatusIngestor` / `OfferLifecycle` or a status-capture gap. Check the ~10s status poll is running (daemon logs) and reaching `POST /sessions/{id}/statuses`.
- Stuck STARTED/ACCEPTED offers are cleaned by `offers:finalize-stale` (5-min schedule; 100-min / 20-min thresholds). Confirm the `scheduler` container is up (`schedule:work`).
- A missed accept-window rejection is cleaned by `offers:expire-pending` (every minute).

**Push not received (driver app).**
- On prod, the most likely cause is that FCM isn't wired (`FCM_CREDENTIALS` unset → `LogPushSender`). Grep backend logs for the logged push. Fix per §6.
- Otherwise: is a `device_token` registered for that driver? Is Android notification permission granted? Is it a **dev/production build** (Expo Go can't do FCM)?
- Geocode/enrich failures don't block push (offer still routes); they only mean the body lacks distance — check `offers:backfill-geo` and Nominatim/OSRM rate limits.

**Where to look:** daemon → container logs; backend events → `RidyLog::event` entries and `storage/logs`; Uber session/daemon/proxy health at a glance → the super-admin **System Health** page (`GET /api/v1/admin/system-health`).

---

## 9. Gotchas

- **Next.js 16 ≠ your training data.** `frontend/AGENTS.md` warns that APIs/conventions differ; it says to read `node_modules/next/dist/docs/` before writing frontend code. Those docs only exist after `npm install` (they're not committed). Frontend is pinned to `next@16.2.7`, React 19.
- **The tenant global scope is silent.** Queries on `BelongsToTenant` models are auto-filtered to the active tenant — and the scope is a **no-op** when no tenant is set (console, seeders, the daemon controller). In those contexts you must scope explicitly (`where('tenant_id', …)` or `withoutGlobalScopes()`), as the driver-invite lookup does.
- **Two auth guards.** Dashboard = `auth:sanctum` (SPA cookie, `web`/`users`); driver app = `auth:driver` (bearer, `drivers`). Don't cross them. Driver data routes also need `driver.active`.
- **Geocoding rate limits.** Nominatim/OSRM are the public shared instances (1 req/s etiquette). Enrichment is best-effort, cached, capped at 5 attempts, and backfilled on a schedule — don't add per-request geocoding to hot paths.
- **Idempotency everywhere.** Offer ingest is idempotent on `offer_uuid`; lifecycle transitions are guarded no-ops. Re-delivery from the daemon/extension is expected and safe by design.
- **Legacy names.** `Ridy` / `DASHCAM` / `fleeteye` in code and docs all mean Reidey. Env `FCM_SERVER_KEY` in the prod compose is legacy and unused by the current HTTP-v1 sender.
- **Prod queue/cache = database, not Redis.** Redis + Horizon exist only in the dev `docker-compose.yml`.
</content>
