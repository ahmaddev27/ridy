# Robust address & trip resolution — implementation plan

**Status:** planned (not started). Start after the current mobile-release work.

## Problem

Uber offer addresses are unreliable: sometimes no street, no postal code, odd
formatting (`42799 Leichlingen (Rheinland)-Kradenpuhl, Deutschland`), or localized
to another script. When geocoding fails, the offer detail shows **no distance and
no €/km** — the single most important numbers for the driver's decision — and the
map plots only one point.

Goal: **every offer with (at least) a postal code produces a coordinate, a
distance, and a €/km**, with a confidence flag; only truly unlocatable addresses
degrade — and never to a blank or a wrong 500 km.

Already shipped (context): postcode↔city fill on the location tail
(`ensureCity`), driver-GPS/pickup bias for postcode-less addresses, and
street-less→Bahnhof detection. This plan makes the resolution robust and always
produces usable numbers.

---

## Phase 1 — Local PLZ database (the backbone)

A static German postal-code table is the safety net: any address carrying a valid
PLZ can always resolve to at least the town centre.

- **Data:** open German PLZ dataset — `plz`, `city`, `lat`, `lng` (centroid),
  optional `bundesland`. ~8,200 rows. Sources: `zauberware/plz` (CSV) or
  OpenPLZ / suggest.osm — pick one, commit the CSV under `backend/database/data/`.
- **Table:** `postal_codes` (`plz` PK char(5), `city`, `lat` decimal(9,6),
  `lng` decimal(9,6), `bundesland` nullable). Migration + a seeder that imports
  the CSV (idempotent upsert).
- **Service:** `App\Domain\Geo\PostalCodes` with `centroid(string $plz): ?array`
  and `city(string $plz): ?string`, backed by an in-memory/`Cache` lookup so it
  is O(1) and does no HTTP.

Deliverable: given `42799` → `{lat, lng, city: "Leichlingen"}` with zero network.

---

## Phase 2 — Multi-tier geocoding cascade (`TripGeocoder`)

Replace the single free-text query with a cascade; stop at the first tier that
returns a point, and record its confidence.

1. **Structured Nominatim** — parse the address into `street`, `postalcode`,
   `city` and query Nominatim's structured params (not free-text `q`). Far more
   robust to Uber's garbled strings. → confidence `exact` (has house number) or
   `street`.
2. **PLZ + city** (structured, no street). → confidence `area`.
3. **PLZ centroid** from `postal_codes` (Phase 1). → confidence `postal`.
4. **Bias fallback** (existing): driver GPS for pickup, resolved pickup for
   dropoff, for addresses with no PLZ at all. → confidence `approx`.

Parsing helper: extract a 5-digit PLZ (`/\b\d{5}\b/`), the city (token after the
PLZ, stripped of `(...)`/`-suffix` noise), and the street (segment before the
PLZ). Keep it in `AddressNormalizer` next to `clean()`.

Cache key already region-aware for biased lookups — extend it to also key on the
tier so a low-confidence hit never masks a later exact one.

---

## Phase 3 — Always produce a distance (`route()`)

- If OSRM returns a route → real road distance + geometry (`exact`).
- If OSRM is unreachable OR one end is only `postal`/`approx` → **haversine ×
  1.3** road factor as an estimated distance, **no geometry**, flagged
  `estimated`. Never leave distance/€-per-km blank when both ends have a
  coordinate.

---

## Phase 4 — Confidence surfaced to the UI

- Store `geo_confidence` on `dispatch_offers` (`exact` | `street` | `area` |
  `postal` | `approx` | `estimated`), set during enrich.
- API (`DispatchOfferController::trip`) returns it.
- Dashboard + app: show a subtle `≈` / "approx." chip on distance & €/km when
  confidence is below `street`, so the number reads as an estimate, not a
  precise figure. Exact stays clean.

---

## Phase 5 — Backfill & rollout

- Command `offers:regeocode {--since=} {--confidence=}` to reset `geo_synced_at`
  and re-run enrich for the affected window (reuses `offers:backfill-geo`).
- Roll out behind a check: log a one-line summary per tier count so we can see
  how many offers use each fallback in production.

---

## Testing

- `PostalCodes` unit test: known PLZ → centroid + city; unknown → null.
- `TripGeocoder` cascade (HTTP faked): exact hit; street-less → area; PLZ-only →
  centroid; garbage → bias; each asserts the right `geo_confidence`.
- `route()`: OSRM ok → exact; OSRM down but two coords → haversine estimate
  (never null when both ends resolve).
- Extend `EnsureCityTest` fixtures with the real bad case
  (`42799 Leichlingen (Rheinland)-Kradenpuhl`).

---

## Files (touch list)

- `backend/database/data/postal_codes.csv` (new, committed)
- `backend/database/migrations/*_create_postal_codes_table.php` (new)
- `backend/database/seeders/PostalCodesSeeder.php` (new)
- `backend/app/Domain/Geo/PostalCodes.php` (new)
- `backend/app/Domain/Dispatch/AddressNormalizer.php` (parse helpers)
- `backend/app/Domain/Dispatch/TripGeocoder.php` (cascade + haversine + confidence)
- `backend/app/Http/Controllers/Api/V1/DispatchOfferController.php` (expose confidence)
- `backend/database/migrations/*_add_geo_confidence_to_dispatch_offers.php` (new)
- `frontend` offer detail + `driver-app` offer screen (confidence chip)
- tests as above

---

## Effort / impact

| Phase | Effort | Impact |
|---|---|---|
| 1 PLZ table | S (one CSV import) | High — guaranteed fallback point |
| 2 Cascade | M | High — robust to garbage input |
| 3 Haversine distance | S | High — never blank distance/€km |
| 4 Confidence UI | S | Medium — trust/clarity |
| 5 Backfill | S | Fixes historical rows |

Start with **Phase 1 + 3** for the biggest immediate win (a point + a distance
for every PLZ), then 2 and 4.

---

## Addendum (2026-11-05) — Receipt snapshot, clean-after-accept, and chaining context

**Status:** proposed, NOT started. Assessed against `origin/main` (cfe47cb). Design only: no code in
this addendum. Companion to `docs/29-addresses-and-geocoding.md` (the AN/AF/AL/TG/DOI/OL/DSI
abbreviations are used as defined there).

### Owner requirement

For every offer the system should hold:

1. **At receipt** — the raw Uber offer exactly as Uber sent it, plus the driver's live lat/lng at that
   instant (where the driver physically was when the offer landed).
2. **After the driver accepts** — the clean, refined, geocoded pickup + dropoff as plotted on the map.
3. **Chaining context** — if the driver already has an active ride A→B, is currently at C, and a new
   offer arrives with pickup D, relate the current ride's dropoff (B) to the new pickup (D) so the
   logistics of chaining can be judged.

### Gap analysis (what exists vs. what is missing)

| # | Requirement | Verdict | Where it lives today | What is missing |
|---|---|---|---|---|
| 1a | Raw Uber payload as received | **HAVE** | `dispatch_offers.raw_payload` (JSON, cast `array`), written verbatim from `$offer` in `DOI::route` | Nothing for storage. Caveat: wiped to `{}` by `OfferAnonymizer` at the retention cutoff (which also clears all coordinates). |
| 1b | Driver lat/lng at receipt, on the offer | **MISSING** | Only `drivers.latitude/longitude/heading/location_updated_at` (`DSI` ~:141-167), overwritten on every status poll and nulled by `fleet:purge-stale-locations` after `Driver::LIVE_STALE_MINUTES` (10). `TG::enrich` (:143) reads `$driver->latitude` as a geocoding bias only, at enrich time (seconds to minutes after receipt), never persisted onto the offer, and skipped entirely on the dispatch-decline fast path. | A receipt-time snapshot set in `DOI::route` at `create()` time. |
| 2a | Raw addresses preserved | **PARTIAL** | `pickup_address`/`dropoff_address` hold `AF::tidy()` output (country tail stripped, whitespace fixed), so NOT byte-identical to Uber. Byte-exact strings survive only inside `raw_payload`. `TG::enrich` never rewrites these two columns. | Nothing urgent: `raw_payload` is the raw source of truth. Document it as such; do not repurpose `pickup_address`. |
| 2b | Clean post-accept addresses stored distinctly | **PARTIAL (overwrites)** | `TG::applyFromWaypoints` (:1114-1169) overwrites `pickup_lat/lng`, `dropoff_lat/lng`, `*_display`, `distance_m`, `route_geometry`, `stops`, and sets `geo_source='uber'`, `geo_confidence='exact'`. | The text-geocode result at receipt (coords, confidence, display) is **lost** the moment waypoints land. No "receipt geocode" vs "accepted/clean" separation, so geocoder error cannot be measured against Uber's truth (the ~60% `geo_source=uber` population in docs/29 §2.5 is exactly the data that would calibrate it). |
| 3a | Driver's active trip + its dropoff (B) at offer receipt | **DERIVABLE, not captured** | Active offer = `OL::activeOfferFor` (status Accepted/Started, newest) and its `dropoff_lat/lng` (or last point of `drivers.trip_waypoints`). Nothing is read or stored at `DOI::route` time. | A lookup in `DOI::route` and a persisted link. |
| 3b | Link between active trip and incoming offer | **MISSING** | `OL::supersedePendingFor` and the back-to-back logic (`OL` ~:172-175) relate offers only after the fact, for status attribution. No FK or column. | `chained_after_offer_id` plus a frozen copy of B and the B-to-D gap. |

Short answer: **#1 is half there** (raw payload yes, driver-location snapshot no), **#2 is half there**
(a clean version exists but it destroys the receipt-time geocode), **#3 is not captured**, although
every ingredient is already ingested.

### Does the current work fit? What would we lose?

**Yes, it fits.** The cascade (Phases 1-4, shipped and documented in docs/29) is orthogonal: the
requirement adds snapshot columns and one lookup at ingest; it does not change the geocoder, the
confidence ranks, or the notify path. Nothing already built needs rework.

What we **lose today** (the argument for doing this):

- The receipt-time geocode is destroyed on acceptance by `applyFromWaypoints`, so geocoder accuracy
  cannot be audited against Uber's coordinates.
- The driver's location at receipt is gone within ~10 min (`PurgeStaleDriverLocations`) and is
  overwritten every poll, so "how far was the driver from the pickup when the offer landed" is not
  reconstructable. `received_at` exists, but the position at that instant does not.
- `raw_payload` and every coordinate die at retention anonymization (by design). Any new snapshot
  column must be added to `OfferAnonymizer::CLEARED`, or it would outlive the policy.

What adopting it risks, and the mitigations:

| Risk | Mitigation |
|---|---|
| Overwriting raw with geocoded | Never touch `raw_payload`; add NEW columns, never repurpose existing ones. |
| Geocode-before-notify budget (0.4 s, DOI:46) | The snapshot copies values already in memory (`$driver` is loaded in `route()` before `create()`): zero extra queries or HTTP. The chain lookup is ONE indexed query and runs **after** the push, next to `supersedePendingFor`, best-effort via `LockRetry`/`rescue`. |
| Storage | 2 decimals + 1 timestamp + two small JSON blobs, roughly <1 KB/row; negligible next to `raw_payload`. |
| N+1 / perf | No loops. The chain lookup reuses the `(tenant_id, driver_uuid, status)` access path of `activeOfferFor`; do not select `raw_payload` in it (MySQL sort-buffer issue documented in `OL::newest`). |
| Extra writes | Snapshot set in the single `create()`; clean-copy fields written inside the existing `applyFromWaypoints` save. No additional UPDATE on the hot path. |

### Privacy (DSGVO "detect, don't surveil")

- **Not new collection.** The position is already ingested (`DSI` status poll) and held on
  `drivers.latitude/longitude`; the geocoder already consumes it. #1 would persist one already-held
  fix per offer instead of letting it be overwritten. That is retention of existing data, not new
  collection, but it changes its character: a transient live position (purged after 10 min) becomes a
  historical per-offer record (a sparse movement trace). Treat it as a posture change that needs the
  owner's explicit OK.
- **Posture:** ONE fix per offer, at receipt, only for offers with a linked driver; no trail, no
  periodic sampling. Store the fix age (`receipt_driver_fix_at`) and write NULL when the stored fix is
  older than `Driver::LIVE_STALE_MINUTES` (never snapshot a ghost position). Consider rounding to 4-5
  decimals (11 m to 1 m) depending on the purpose.
- **Retention:** the driver snapshot, the chain-context copy of B, and the receipt geocode are personal
  data like the existing coordinates. They MUST be added to `OfferAnonymizer::CLEARED` (same cutoff as
  `retention_offer_months`); `DriverEraser`/`EraseDriver` go through `OfferAnonymizer`, so one constant
  covers both. Add a test asserting every new column is nulled.
- **To confirm with the owner:** the purpose statement for the privacy notice (dispatch-quality
  analysis, geocoder calibration), and whether any UI may show the snapshot (recommendation:
  internal/analytics only at first, nothing in driver-app or the manager panel).

### Golden-rule check

| Rule | Impact |
|---|---|
| Observe, don't control | All additions are reads of data we already hold. No Uber write. |
| Never act for the driver | Chain fields are stored context for later judgment; nothing decides or acts on them here. |
| Every push: distance + dropoff + EUR/km, geocoded before notify | Push path unchanged. The snapshot comes from memory at `create()`; the chain lookup runs after the push. The dispatch-decline fast path still skips geocoding and stays ONE bare push. No follow-up push is introduced. |
| Multi-stop = new push | Unchanged. `applyFromWaypoints` triggers `notifyMultiStop` as today; it only additionally stamps `accepted_geo_at`. |
| Idempotent ingest | Snapshot is written once inside `create()`; a duplicate offer returns `duplicate` before it. Receipt-geo and chain writes are set-if-null, so replays cannot shift them. |
| Time model (Europe/Berlin) | New timestamps follow the same Berlin wall-clock convention. |
| Addresses: never change the city wrongly | The receipt geocode is preserved verbatim, so wrong-city regressions become auditable. |

### Proposed data-model additions (all on `dispatch_offers`, all nullable, one migration per phase)

Point 1 — receipt-time driver location:

| Column | Type | Meaning |
|---|---|---|
| `receipt_driver_lat` / `receipt_driver_lng` | decimal(9,7) null | Driver position when the offer landed, copied from `drivers.latitude/longitude` in `DOI::route`. NULL when no linked driver, no fix, or fix older than `LIVE_STALE_MINUTES`. |
| `receipt_driver_fix_at` | datetime null | `drivers.location_updated_at` of that fix (age = `received_at` minus this). |
| `receipt_driver_status` | string(32) null | Uber `driverStatus` at receipt (idle / en route / on trip), so analysis needs no join into a mutating row. |

Point 2 — raw vs clean separation:

| Column | Type | Meaning |
|---|---|---|
| (keep) `raw_payload` | json | Raw as sent; source of truth for Uber's strings. No change. |
| `receipt_geo` | json null | Frozen result of the text geocode at receipt: `{pickup:{lat,lng,display,confidence}, dropoff:{...}, distance_m, source}`. Written once by `TG::enrich` (set-if-null). |
| (keep) `pickup_lat/lng`, `dropoff_lat/lng`, `*_display`, `distance_m`, `geo_source`, `geo_confidence` | existing | Explicitly become "current best / clean": text geocode until accept, Uber waypoints after. Semantics unchanged, so zero consumer impact. |
| `accepted_geo_at` | datetime null | When the clean (waypoint-resolved) version was written. |

One JSON column instead of eight: it is write-once, read-rarely audit data, and it keeps the wide table
narrow. Promote fields to columns only if analysis needs to filter on them.

Point 3 — chaining context:

| Column | Type | Meaning |
|---|---|---|
| `chained_after_offer_id` | unsignedBigInteger null, indexed | The driver's active (Accepted/Started) offer at receipt, via `OL::activeOfferFor`. Plain indexed column, not a hard FK (offers get anonymized). |
| `chain_context` | json null | Frozen at receipt: `{current_dropoff:{lat,lng}, driver:{lat,lng}, gap_m, gap_method}`. B = last stop of the active offer (final `trip_waypoints` point, else `dropoff_lat/lng`); `gap_m` = B to D distance (haversine; no OSRM on the hot path). |

Definitions: A = active offer's pickup (history only), B = active offer's dropoff, C = driver position
(`receipt_driver_*`), D = new offer's pickup. D has no coordinate at receipt (offers carry text only),
so `gap_m` is computed **after** D is geocoded, in `GeocodeOffer`/`TG::enrich` (already off the hot
path), not in `DOI::route`. The link and B are captured at receipt; the distance fills in once D
resolves. The push path stays untouched.

### Phased implementation plan (no code in this PR)

**Phase A — Receipt snapshot (small, highest value, lowest risk).**
Migration adding `receipt_driver_*`. In `DOI::route`, set them inside the existing `create()` from the
already-loaded `$driver` (guard on `location_updated_at` freshness). Add them to
`OfferAnonymizer::CLEARED` and its test. No added query, no effect on push latency. Tests: set with a
fresh fix; NULL for a stale fix or unlinked driver; duplicate offer does not re-snapshot; anonymizer
clears the columns.

**Phase B — Freeze the receipt geocode before accept overwrites it.**
Add `receipt_geo` + `accepted_geo_at`. `TG::enrich` writes `receipt_geo` once (set-if-null) after a
successful resolve; `applyFromWaypoints` stamps `accepted_geo_at`. Offers accepted before enrich ever
ran keep `receipt_geo` null (never backfill from the overwritten value). Fast-path
(dispatch-reject) tenants have no receipt geocode until `GeocodeOffer` runs: expected. Tests:
`receipt_geo` survives `applyFromWaypoints`; replay does not alter it; `saveUnlessUberResolved` still wins.

**Phase C — Chain link.**
Add `chained_after_offer_id` + `chain_context`. In `DOI::route`, AFTER `notifyDriver` and beside
`supersedePendingFor` (best-effort, `LockRetry`, never fails the batch), call `OL::activeOfferFor` and
write the link + B. Compute `gap_m` in `GeocodeOffer` once D resolves. Tests: a driver with an active
trip yields the link and B; idle driver yields null; superseded/duplicate paths unchanged; the query
runs after notify.

**Phase D — Analysis only.**
Read-only CLI/report (`offers:chain-report`; a calibration query of `receipt_geo` vs accepted Uber
coordinates). No driver-app or push changes. Any UI exposure is a separate owner decision.

**Phase E — Retention and docs.**
Verify anonymizer + `DriverEraser` coverage; update docs/29 (§0 column list, §3 discrepancy list),
HANDOFF.md change log, and the privacy-notice wording.

### Open questions for the owner

1. Is chaining judged on B to D only, or also C to D (current position to new pickup)? The schema
   stores both inputs; the analysis choice can follow.
2. Stored precision of the driver position (4 vs 5 decimals) and retention (same as offers, or shorter
   for the position specifically)?
3. Keep `receipt_geo` for offers that never reach acceptance (declined/expired)? Recommended yes: that
   is exactly where geocoder quality matters most for the decline decision.
