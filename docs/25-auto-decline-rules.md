# 25 — Auto-decline rules ("Early decline" / رفض مبكر)

**Status:** design, approved by owner 2026-10-31. Build in phases; pilot on ONE company.

A driver sets standing rules (min fare, cities, distance). When a matching offer
arrives, Reidey declines it from the dispatch panel **automatically** — within
~2–4 s, before any push or pop-up reaches the driver — so the driver is never
bothered by offers they already said no to, and (owner-verified) the dispatch
decline does **not** touch their Uber acceptance rate.

This is the auto-declined offer's user-facing status everywhere: **Early decline**
· DE *Früh abgelehnt* · AR *رفض مبكر* (chosen 2026-10-31). It fits: an auto-decline
is the one kind that genuinely lands early.

---

## Why this is possible (the measurements behind it)

- **Offer freshness:** the dispatch stream hands us the offer at offer-age **p50 0 s,
  p90 1 s** (n=5598). We see it effectively the instant Uber generates it.
- **Command delivery:** the daemon long-polls `/commands`; the backend answers the
  instant a row appears, inner poll 150 ms ({@see DispatchCommandQueue}). Delivery ≈
  150 ms, not seconds.
- **The human was the slow part:** manual declines measured min 3.8 s / p50 7 s —
  that floor is the driver reading the pop-up and deciding. Remove the human and the
  system path is: offer (~0–1 s) + rule check (cache, ~0 s) + delivery (~150 ms) +
  Uber call (~1 s) ≈ **1.5–2.5 s**. So a ≤3–4 s auto-decline is comfortable.
- **Rate protection is NOT timing-dependent:** owner verified a dispatch decline
  (even late, within the ~75 s `deliveryDeadline`) does not hurt the acceptance rate.
  So speed here buys *invisibility*, not rate safety.

### The one honest limit
We suppress **our** push, so the offer is invisible *through Reidey*. We cannot
suppress Uber's own direct channel — the driver's Uber app may flash the offer for
the ~2 s until our decline removes it. "Invisible" means "no Reidey notification +
gone from Uber fast", not "the driver's Uber app never rendered it".

---

## Golden-rule amendment (REQUIRED before code)

AGENTS.md rule #1 says the decline is "triggered by the driver in the app or by a
manager on the panel … never auto-decide for the driver." This feature adds a third
trigger: **the driver's own pre-set rules**. It stays within the spirit — it is the
driver's decision, pre-expressed; still only ever a *decline* (never accept); still
records Uber's answer. The amendment is explicit and company-gated + per-driver
opt-in. Update AGENTS.md in the same change that lands the engine.

---

## Data model

- `tenants.settings['auto_decline']['enabled']` (bool) — the COMPANY has the feature
  (mirrors `dispatch_reject`). Absent = off. Implies `dispatch_reject.enabled`
  (a decline needs a live dispatch session).
- `drivers.auto_decline` (JSON, nullable) — the driver's own config:
  ```json
  {
    "enabled": true,
    "rules": {
      "min_fare":            { "enabled": true, "value_e2": 900 },      // reject fare < 9.00 €
      "reject_cities":       { "enabled": true, "cities": ["Solingen"] },
      "max_pickup_distance": { "enabled": true, "km": 8 },              // reject pickup > 8 km from driver
      "max_trip_distance":   { "enabled": false, "km": 40 }
    }
  }
  ```
  Money in integer cents (`_e2`) — never a float. Each rule independently toggleable.
- `dispatch_offers.auto_decline_reason` (string, nullable) — which rule fired
  (`min_fare` | `reject_cities` | `max_pickup_distance` | `max_trip_distance`), or
  null for a manual/other decline. This column IS the auto-decline log: the offer is
  already the record; the history views query it. Pairs with the existing
  `dispatch_rejected_at`.

No new tables: driver config is JSON on the driver, the event log is the offer row.

---

## Rule engine (at ingest, best-effort, cache-first)

In `DispatchOfferIngestor`, after the driver is matched and BEFORE `notifyDriver`:

1. Gate: tenant feature on + `driver.auto_decline.enabled` + `canReject(offer)`.
2. Evaluate rules on **instantly-available** data only (the ≤3–4 s budget forbids a
   cold network call):
   - `min_fare` — `fare_amount` from the payload. Always instant.
   - `reject_cities` / `max_trip_distance` — pickup/dropoff **geocoded from CACHE
     only** (the fleet's recurring streets are warm). A cache miss = rule skipped for
     this offer (do NOT geocode live — never delay the decline).
   - `max_pickup_distance` — haversine(`drivers.latitude/longitude` [Uber Fleet-Hub
     last position, instant], pickup coords [cache]). Skipped if the driver's live
     position is stale/absent or the pickup is a cache miss.
3. If ANY enabled rule matches → **auto-decline**:
   - Queue the dispatch decline immediately (existing `DispatchActionService` path).
   - **Suppress** `notifyDriver` — no push, no broadcast, no pop-up.
   - Stamp `auto_decline_reason`. New ingest status `early_declined`.
4. No rule matches (or none evaluable) → normal flow (notify as today).

**Best-effort is deliberate:** a matching offer with a cold pickup slips through to
the normal push rather than blow the latency budget. The fleet's hot streets cover
the common case; the long tail is rare and self-heals as the cache warms.

**Timing:** fire immediately (no jitter) — owner wants ≤3–4 s. The bot-detection risk
(rapid machine-timed declines on the org dispatch session) is the pilot's main watch
item; revisit jitter if Uber pushes back.

---

## Surfaces

**Driver app** — a new, feature-gated tab in the bottom nav:
- Settings: master toggle + each rule (min fare, cities multi-select, pickup-distance
  km, trip-distance km). German default; Latin digits for money/distance.
- History: a component like `submissions` — dated list of Early-declined offers with
  filtering, each showing the offer and the **reason**.

**Fleet-owner app** (owner mode, same build):
- The same feature page but **read-only** on settings, with a **per-driver filter**
  (owner never edits a driver's rules).
- Add a **driver filter** to the existing submissions (receipts) and notes lists.

**Dashboard (web, owner):**
- A management section: which drivers have it enabled + their chosen rules, a filtered
  list of Early-declined offers, and a complete overview. Read-only on driver config.

---

## Endpoints (sketch)

- `GET /driver/auto-decline` — the signed-in driver's config + available cities.
- `PUT /driver/auto-decline` — update own config (feature-gated; 403 otherwise).
- `GET /driver/auto-decline/history` — own Early-declined offers (paginated, filters).
- Owner/dashboard: `GET /fleet/auto-decline` — per-driver config + events, driver filter.

---

## Build phases

0. **Data model + this doc + golden-rule amendment.** (migration, model helpers)
1. **Engine, price rule only**, suppression + `auto_decline_reason` + `early_declined`
   status + tests. Pilot on ONE opt-in company. Watch the dispatch session for 403s.
2. Driver-app tab: settings + history.
3. Owner-app: read-only per-driver view + driver filters on submissions/notes.
4. Dashboard management section.
5. City + distance rules (cache geocode + Fleet-Hub driver position).

Rollback at any phase: `tenants.settings['auto_decline']['enabled'] = false` makes the
whole engine dormant (same lever as `dispatch_reject`).
