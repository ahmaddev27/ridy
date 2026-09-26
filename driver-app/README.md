# Reidey Driver — mobile app (Expo)

The driver-facing app. A driver is invited from the manager dashboard, signs in
with a one-time email code (no password), and then receives **instant,
high-priority push notifications** for each Uber offer routed to them — fare,
€/km quality, pickup, drop-off and distance. Acceptance still happens inside the
Uber Driver app (Reidey observes, it doesn't control the trip). Fleet owners /
managers can sign into the same app as a read-only fleet monitor.

## Stack

- Expo SDK 57 / React Native 0.86 + Expo Router (file-based routing under `app/`)
- `expo-notifications` receives FCM on Android; `@react-native-firebase/messaging`
  mints the FCM token on iOS. Its Android receive components are stripped by
  `plugins/withExpoOwnsFcm.js` (otherwise they swallow foreground pushes).
- `expo-secure-store` for the Sanctum bearer token (+ a reinstall guard in
  `src/lib/install-guard.ts`, because the iOS Keychain survives uninstall)
- Laravel Reverb (WebSocket) via `laravel-echo` — one socket per session
  (`src/lib/live.ts`); polling is only the fallback
- Sentry (`src/lib/sentry.ts`) — DSN from the build env or `extra.sentryDsn`
- No UI framework — a small themed component set in `src/components/`;
  icons come only from `src/components/icons.ts` (never the lucide barrel)

## Run

```bash
cd driver-app
npm install
npx expo run:android      # or run:ios — push needs a dev build, not Expo Go
```

## Configuration

- **API base URL** — `app.json` → `expo.extra.apiUrl` (default `https://reidey.de`).
- **Deep link** — scheme `reidey://` (only `reidey://offer/<numeric id>` is used).
- **FCM** — `google-services.json` and `GoogleService-Info.plist` are
  **committed on purpose** (client config, key-restricted). Store/signing
  credentials (`ios-asc-key.p8`, `play-service-account.json`, keystores) must
  stay out of git AND out of EAS uploads — the repo-root `.easignore` replaces
  `.gitignore` for EAS, so every secret pattern is repeated there.

## Releases

- `eas.json` uses `appVersionSource: remote`: EAS manages `versionCode` /
  `buildNumber` (don't set them in `app.json`).
- `runtimeVersion` uses the **fingerprint** policy: any native change (a native
  dependency, a config plugin, notification sounds/icons) produces a new runtime,
  so an `eas update` can never reach a binary it doesn't match. A JS-only change
  keeps the runtime and ships OTA. Bump `expo.version` for every store build.
- The fingerprint hashes files by **content**, so line endings matter. Store
  builds run on Linux CI (LF); `driver-app/.gitattributes` forces LF so a Windows
  checkout hashes the same bytes. After pulling that file into an existing
  Windows checkout, re-checkout once so the working tree is LF:
  `git rm -r --cached -q driver-app && git reset --hard` (clean tree only).
- **Before every `eas update`**, confirm the local runtime matches the store
  build: `npx expo-updates fingerprint:generate --platform android` (and `ios`)
  must print the same hash as the build's runtime version on expo.dev
  (or run `eas fingerprint:compare`). Prefer publishing OTAs from Linux/CI,
  the same OS the builds come from. A mismatch publishes to a runtime no
  installed app has — drivers silently get nothing.
- iOS: `ios.entitlements` enables **Time Sensitive Notifications** (the backend
  sends offer pushes with `interruption-level: time-sensitive` so they break
  through Focus/Driving). EAS capability sync enables it on the App ID; with
  `EAS_NO_CAPABILITY_SYNC` set, enable it manually in the Apple Developer portal
  before the build.
- Running apps pick up an OTA update on resume and apply it the next time the
  app goes to the background (`src/lib/ota.ts`).
- Force-update gate: the backend `app_min` setting (checked on launch/resume).
- Production builds auto-submit to the Play **alpha** track.

## Backend endpoints used

- `POST /api/v1/driver/login/request`, `/login/verify` — OTP sign-in
- `GET/PATCH /api/v1/driver/me`, `POST /driver/logout`
- `POST/DELETE /api/v1/driver/devices` — this device's FCM token
- `GET /api/v1/driver/home`, `/stats`, `/offers`, `/offers/{id}`
- `POST /api/v1/driver/account/deletion-request` — in-app account deletion
- Owner mode: the same under `/api/v1/driver/fleet/*` (User token)

## Screens

| Route | Purpose |
| --- | --- |
| `app/splash.tsx` | Brand bridge from the native splash |
| `app/onboarding.tsx`, `app/language.tsx` | First run: intro + language (de/en/ar) |
| `app/login.tsx` | OTP sign-in (email → 6-digit code), privacy/imprint links |
| `app/(tabs)/index.tsx` | Home: new/active offer, today's numbers, recent offers |
| `app/(tabs)/offers.tsx` | Offer history with search, period and status filters |
| `app/(tabs)/statistics.tsx` | Income and counts per fleet-day / week / month |
| `app/(tabs)/profile.tsx` | Identity, support, privacy |
| `app/offer/[id].tsx` | Offer detail with the live accept-window countdown |
| `app/settings.tsx` | Language, in-app alerts, theme, legal, account deletion, logout |
