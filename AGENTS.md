# Reidey — Agent Guide (read this first)

You are working on **Reidey** (`reidey.de`): a multi-tenant SaaS for German Uber-fleet
operators. It taps each fleet's **live Uber dispatch (RAMEN) offer stream**, matches every
ride **offer** to the fleet's driver by their Uber UUID, and fires an instant push to that
driver's phone (fare, €-quality, pickup/dropoff, road distance) inside Uber's ~5-second
accept window. **It observes Uber — with exactly one write: a dispatch-side decline of a
still-pending offer** (see golden rule #1), off by default, per company.

Legacy names in code/docs — `Ridy`, `DASHCAM`, `fleeteye` — all mean Reidey.

---

## Where to look (don't reinvent — these are kept current)

| Need | File |
| --- | --- |
| **How the system works + how to work on it** (mental model, per-subsystem deep-dive, data model, conventions, deploy, runbook, gotchas, the agent operating guide, and a **dated change log** of the latest work) | **[`HANDOFF.md`](./HANDOFF.md)** — start here |
| **Current status / what's done / what's next** (living roadmap) | **[`ROADMAP.md`](./ROADMAP.md)** |
| Deep design/feasibility/ops notes | [`docs/`](./docs) — see the doc map in HANDOFF; docs `01`–`07` are **legacy pre-pivot** (old Samsara product), the rest are current. |

**On every task:** read `HANDOFF.md`'s change log + operating guide, `git log --oneline -20`,
then grep before writing. Reuse the existing service/helper — the backend is service-layered
(Controllers → Services in `app/Domain/**` → Models).

---

## Golden rules — do NOT break without explicit confirmation

- **Observe, don't control — with one carved-out exception.** The **only** write Reidey ever
  makes to Uber is a **dispatch-side decline of a still-pending offer** (`RejectOffers` on
  `vsdispatch.uber.com`, the org/dispatch session the daemon already holds), triggered by the
  driver in the app or by a manager on the panel, and gated by the per-company flag
  `tenants.settings['dispatch_reject']['enabled']` (absent = OFF). It declines **from the
  dispatch panel**, which is the whole point: it does not count against the driver's Uber
  acceptance rate. Nothing else: **never accept** (`AcceptOffers` is deliberately dormant —
  no route, no UI), never start/end a trip, never message a rider, never auto-decide for the
  driver. Acceptance stays **inferred from Uber driver status only** (`DriverStatusIngestor` +
  `OfferLifecycle`); the decline is the one thing we command, and we record Uber's answer
  rather than assume it. Do not reintroduce a timeline reconciler — it was tried and reverted.
- **Time model:** timezone **Europe/Berlin**, week starts **Monday**, the Uber fleet-day
  starts at **04:00**. All stats/windows use fleet-days.
- **Every offer push carries** distance + dropoff + €/km with the €-quality badge; geocode
  **before** notifying. A multi-stop ride pushes a new notification with per-stop detail.
  **Exception, flag-gated:** a company with dispatch declines **enabled** gets **two** pushes
  per offer. The *first* is deliberately **bare** — no geocoding at all, by the owner's
  decision, because a decline is only worth anything while the offer is still open. The
  *second* carries the distance, €/km and badge, and is sent **only once the decision window
  has closed and only if the offer was not declined** (`SendEnrichedOfferPush`): a decline
  means the ride never became the driver's, so following it with its price would argue with a
  decision they just made. The invariant holds unchanged for every other tenant, and the flag
  is OFF unless someone set it.
- **No offer notification carries action buttons** — not the bare one, not the enriched one.
  The one decision lives in the app's pop-up, on the screen that shows the fare and the
  countdown it should be judged on; a tap on a tray notification, under time pressure and away
  from that context, is the wrong place for it. "Open in map" was removed for the same reason:
  it meant nothing on an offer nobody had taken, and once the ride IS the driver's they are on
  the offer screen, which has the button. The `offer` category is still registered (with an
  empty action list) because the backend sets `categoryId` to mark an offer push, and that is
  what gives it its TTL and collapse key.
- **Addresses:** maximize geocoding; **never change the city wrongly** (authoritative
  city/PLZ wins over a mis-biased reverse-geocode).
- **i18n:** German is the **default** (de/en/ar everywhere, RTL for ar). Money/distance/dates
  always render **Latin digits**, even in Arabic.
- **Scope discipline:** keep fixes narrow; don't re-architect settled fundamentals to land a
  small fix. Offer ingest + lifecycle transitions are **idempotent** by design.
- A fixed **OTP test code** path (`OTP_TEST_CODE`) is intentional — leave it. Product posture
  is DSGVO "**detect, don't surveil**": don't add data collection beyond a feature's need.

---

## Workflow (the definition of done)

1. Change the **smallest surface** that fixes it.
2. **Verify** the surface you touched:
   - `backend/` → `cd backend && vendor/bin/pint --test && php artisan test`
   - `frontend/` → `cd frontend && npm run build` (Next 16 ≠ training data — read `node_modules/next/dist/docs/` first)
   - `driver-app/` → `cd driver-app && npx tsc --noEmit`
   - `dispatch-daemon/` → `node -c src/<file>.js`
3. **Commit** on `main` with a Conventional Commit + `Co-Authored-By: Claude …` trailer.
4. **Update `HANDOFF.md`** (a dated change-log line + fix any section made stale) and, when
   status moved, **`ROADMAP.md`** — in the same commit. Then `git push origin main`.
   A change isn't done until the living docs reflect it and it's pushed.

Deploy: `backend/` is volume-mounted (git pull + `migrate --force` + `config:clear` +
`restart backend scheduler queue`; CI does this on push to `main`). `frontend`/`daemon`
rebuild their image. `driver-app` ships **OTA** (`eas update`) unless a native module changed.

## Stack

Laravel 13 (PHP 8.4) · MySQL 8 (SQLite in dev) · Next.js 16 / React 19 / Tailwind v4 ·
Expo SDK 57 driver app · Node daemon · Chrome MV3 extension · FCM (HTTP v1) · Reverb
(WebSocket) · Docker Compose + Caddy on one VPS.
