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
