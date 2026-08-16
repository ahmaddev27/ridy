# Reidey Driver — mobile app (Expo)

The driver-facing app. A driver is invited by email from the manager dashboard,
activates an account, and then receives **instant, high-priority push
notifications** for each Uber offer routed to them — with the fare, pickup,
drop-off, distance and a live countdown. Acceptance still happens inside the
Uber Driver app (Reidey observes, it doesn't control the trip).

## Stack

- Expo SDK 52 + Expo Router (file-based routing under `app/`)
- `expo-notifications` for FCM (native device push token → backend)
- `expo-secure-store` for the Sanctum bearer token
- No UI framework — a tiny themed component set in `src/components/ui.tsx`

## Run

```bash
cd driver-app
npm install
npm start           # then press a / i, or scan with Expo Go (dev only)
```

Push notifications require a **development build** (not Expo Go):

```bash
npx expo run:android      # or run:ios
```

## Configuration

- **API base URL** — `app.json` → `expo.extra.apiUrl` (defaults to `https://reidey.de`).
- **Deep link** — scheme `reidey://`. The invitation email links to
  `https://reidey.de/driver/activate?token=…`; wire your universal link (or
  test with `npx uri-scheme open "reidey://activate?token=XYZ" --android`).
- **FCM** — drop the Firebase Android `google-services.json` (and iOS
  `GoogleService-Info.plist`) into this folder. They are git-ignored.

## Backend side (already implemented)

- `POST /api/v1/driver/login`, `/activate`, `GET /invite/{token}`
- `POST /api/v1/driver/devices` — registers this device's FCM token
- `GET /api/v1/driver/offers` — the driver's own offer history
- Offers are pushed by `DispatchNotifier` via FCM HTTP v1 (high priority). Set
  `FCM_CREDENTIALS` (service-account JSON path) + `FCM_PROJECT_ID` on the server.

## Screens

| Route | Purpose |
| --- | --- |
| `app/login.tsx` | Email + password sign-in |
| `app/activate.tsx` | Consume the emailed invitation, set a password |
| `app/(tabs)/offers.tsx` | Offer history, pull-to-refresh |
| `app/offer/[id].tsx` | Offer detail with the live accept-window countdown |
| `app/(tabs)/settings.tsx` | Profile, language (de/en/ar), logout |
