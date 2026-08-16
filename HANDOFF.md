# Reidey — Engineering Handoff

A complete operational + architectural handbook. Audience: an engineer (or another AI model) picking up the project with no prior context. Everything here is verified against the code on `main`; file paths are relative to the repo root unless noted.

---

## 1. Mental model

**What Reidey does.** German Uber-fleet operators run many drivers under one Uber "org". Uber sends ride **offers** to drivers with only a ~5-second accept window. Reidey taps the fleet's own **live Uber dispatch stream** (Uber's internal "RAMEN" server-sent-events feed), figures out which of the fleet's drivers each offer is for, and instantly pushes it to that driver's phone with the fare, €-quality, addresses and distance — so the driver can decide fast.

**The one principle: observe, don't control.** Reidey never accepts, rejects, starts, or ends a trip. It only *watches* Uber:

- **Offers** come in on the RAMEN stream (push).
- **Trip state** is *inferred*, never commanded. The daemon polls each driver's live Uber engagement status (~10s). When a driver goes idle → EN_ROUTE we infer "accepted"; → ON_TRIP is "started"; back to idle is "completed/canceled". The offer lifecycle is a read-only mirror of what the driver did inside the Uber app.

Keep this principle when extending the product. Anything that would *act on* Uber (auto-accept, cancel, message a rider) is out of scope and legally/ToS dangerous.

**Why the odd plumbing.** Uber blocks datacenter IPs (RAMEN 404s, roster returns 0). So the stream is held either server-side through a **residential proxy** (the `dispatch-daemon`), or in the **manager's own browser** via a Chrome extension (real residential IP). Both are just *capture* transports; the Laravel backend is the brain and single source of truth.

**Naming note.** The product is **Reidey** (domain `r.fleeteye.de`). You will see legacy names in code/comments/docs — `Ridy`, `DASHCAM`, `fleeteye`. They refer to the same system across its rename history.

---

## 2. Architecture deep-dive

### 2.1 Offer pipeline (capture → ingest → match → geocode → push)

**Transport in.** The daemon posts raw offer batches to:

```
POST /api/internal/dispatch/ingest      header: X-Dispatch-Secret: <DISPATCH_INGEST_SECRET>
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
| `device_tokens` | `Domain\Notifications\Models\DeviceToken` | **driver app** FCM tokens: `tenant_id, driver_id, token, platform, last_used_at`. Consumed by `DispatchNotifier`. |
| `user_push_tokens` | `Domain\Notifications\Models\UserPushToken` | **dashboard web push** tokens: `user_id, token, platform, last_used_at`. Consumed by `Notifier::webPush()`. |
| `subscription_codes` | `Domain\Billing\Models\SubscriptionCode` | `code, plan_id, tenant_id, collector_id, amount, paid, expires_at, activated_at`. |
| `plans`, `subscription_periods` | `Plan`, `SubscriptionPeriod` | billing plans and active periods. |
| `collectors`, `collector_payments` | `Domain\Collections\Models\*` | platform-level (not tenant-scoped). |
| notifications (Laravel default) | — | in-app bell; `data->type`, `data->params`, `data->href`. |
| email templates | (email-template model/controller) | admin-editable localized templates; rendered by `EmailTemplateRenderer`, sent by `SendTemplatedMail`. |

Fleet session (the captured Uber session) is stored on the backend and served to the daemon via `GET /internal/dispatch/sessions` (carries `id, tenant_id, uber_org_uuid, cookies, supplier_cookies`).

---

## 4. Conventions

**Service-layer architecture.** Thin controllers → services (`app/Domain/**`) → models/repositories. Business logic lives in the domain services (`DispatchOfferIngestor`, `OfferLifecycle`, `DriverStatusIngestor`, `Notifier`, `DriverInvitationService`, `ProxyPool`, `SystemHealthService`, …), not controllers. Dependencies are injected (e.g. `PushSender` is an interface bound in `AppServiceProvider`).

**i18n.** Three languages everywhere: **de / en / ar**, and **German is the default**.
- Frontend keys live in `frontend/src/lib/i18n/` — chrome/nav in `dictionaries.ts`, per-screen strings split across `screens-a.ts`, `screens-b.ts`, `screens-ridy.ts`, `screens-admin.ts` (merged under `screens.*`). Add a key to **all three** locales.
- Driver app: `driver-app/src/lib/i18n.ts` (flat dot-key dictionaries).
- **RTL** for Arabic: `RTL_LOCALES = ["ar"]`, sets `dir="rtl"` + `lang` on `<html>`.
- **Money = Latin digits always.** Even in Arabic, prices/distances/dates render Western numerals. Frontend uses `latnLocale()` → `"ar-u-nu-latn"` and `toLatinDigits()` (`frontend/src/lib/utils.ts`); the driver app forces the `"en-DE"` locale for all money/distance/time (`driver-app/src/lib/format.ts`). Fares via `Intl.NumberFormat(locale, {style:'currency', currency:'EUR'})`.

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
| `UBER_DISPATCH_BASE_URL` | daemon | default `https://vsdispatch.uber.com`. |
| `UBER_RAMEN_PATHS` | daemon | default `/ramendca/events,/ramenphx/events`. |
| `RIDY_API_URL` | daemon | backend base (prod: `https://${DOMAIN}` via Caddy hairpin). |
| `STATUS_INTERVAL_MS` / `ROSTER_INTERVAL_MS` / `SESSION_POLL_INTERVAL_MS` | daemon | 10s / 30min / 60s defaults. |
| `NEXT_PUBLIC_API_URL` | frontend build | API base for the browser. |

> Per-company proxies are stored in the DB (`proxies.url`, encrypted), not env; `UBER_PROXY_URL` is only the global fallback.

---

## 6. Deployment (prod: Docker Compose + Caddy on one VPS)

Prod stack `docker-compose.prod.yml` (domain `r.fleeteye.de`). Services:

| Service | What |
| --- | --- |
| `caddy` | TLS edge + reverse proxy (auto Let's Encrypt). Given a network alias of `${DOMAIN}` so the daemon reaches the API by public domain over the internal network (VPS hairpin fix). |
| `mysql` | MySQL 8, volume `dbdata`, healthcheck. |
| `backend` | Laravel PHP-FPM. **`./backend` is volume-mounted** (`:/var/www` + anonymous `/var/www/vendor`) — so a deploy is a code sync, not an image rebuild. |
| `scheduler` | same image, `command: php artisan schedule:work` — runs Laravel's cron in one long process (no host crontab). |
| `frontend` | Next.js, built with `NEXT_PUBLIC_API_URL=https://${DOMAIN}`. |
| `dispatch-daemon` | Node RAMEN daemon; env `RIDY_API_URL=https://${DOMAIN}`, `DISPATCH_INGEST_SECRET`, `UBER_*`. |

Backend + scheduler share env via the `x-app-env` YAML anchor (prod uses **database** queue/cache; no Redis/Horizon — those are dev-only in `docker-compose.yml`).

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
docker compose -f docker-compose.prod.yml restart backend scheduler
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
- **Config** (`driver-app/app.json`): `scheme: "reidey"` (deep link `reidey://`), `android.package: de.fleeteye.reidey.driver`, `googleServicesFile: ./google-services.json`, `extra.apiUrl: https://r.fleeteye.de`, `extra.eas.projectId`.
- **FCM needs a dev/production build, not Expo Go.** Drop `google-services.json` (Android) / `GoogleService-Info.plist` (iOS) into `driver-app/` (git-ignored). Local dev build: `npx expo run:android`.
- **EAS build** (`driver-app/eas.json`): profiles `preview` (internal, APK), `development` (dev client, APK), `production` (app-bundle, auto-increment). Preview APK:
  ```bash
  eas build -p android --profile preview
  ```
- **Deep link.** The invite email links to `https://r.fleeteye.de/driver/activate?token=…` (the frontend `/driver/activate` landing page). Test the scheme with `npx uri-scheme open "reidey://activate?token=XYZ" --android`.

---

## 8. Runbook (diagnosing common issues)

**Offers not arriving at all.**
- Check the daemon logs (`docker compose -f docker-compose.prod.yml logs -f dispatch-daemon`). Look for `starting stream …`, `stopping stream …`, `session poll failed`.
- Is there an active fleet session? `GET /api/internal/dispatch/sessions` (with the secret) should list it. If the manager never linked, or the session flipped to `needs_relink` (Uber returned 401/403), no stream runs — the manager must re-link via the extension.
- **Proxy**: a company with no proxy (and no global `UBER_PROXY_URL`) connects directly → Uber blocks it (RAMEN 404, roster 0). Assign a proxy in the admin panel; the daemon restarts that stream automatically.
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
