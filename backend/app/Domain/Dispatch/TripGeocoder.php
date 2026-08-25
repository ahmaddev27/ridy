<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Turns an offer's pickup/dropoff addresses into map coordinates + a road route,
 * using Nominatim for geocoding + OSRM for routing. The base URLs are
 * configurable (services.geo.*) so a self-hosted, rate-limit-free instance can
 * replace the free public services at scale — see docs/self-hosted-geo.md.
 * Results are cached on the offer (and addresses in a shared geocode_cache) so
 * the work runs once, lazily, on first detail view.
 */
class TripGeocoder
{
    private const UA = 'Reidey/1.0 (fleet dispatch; contact: ops@reidey.de)';

    /** Nominatim /search endpoint (self-hosted or public), from config. */
    private function nominatimUrl(): string
    {
        return rtrim((string) config('services.geo.nominatim_url'), '/').'/search';
    }

    /** OSRM driving route endpoint (self-hosted or public), from config. */
    private function osrmUrl(): string
    {
        return rtrim((string) config('services.geo.osrm_url'), '/').'/route/v1/driving';
    }

    /**
     * Give up (mark synced) only after this many failed attempts. The backfill
     * runs every 5 minutes, so ~20 attempts span well over an hour of retries —
     * enough to ride out the free services' rate-limit windows before conceding.
     */
    private const MAX_ATTEMPTS = 20;

    /**
     * Geocode + route an offer once it succeeds, caching on the row. Safe to call
     * repeatedly: a transient failure (rate-limited free services) leaves
     * geo_synced_at null so a later call — or the backfill command — retries,
     * only giving up after {@see MAX_ATTEMPTS}.
     */
    public function enrich(DispatchOffer $offer): DispatchOffer
    {
        if ($offer->geo_synced_at !== null) {
            return $offer; // already done
        }

        $pickup = $this->geocode($offer->pickup_address);
        $dropoff = $this->geocode($offer->dropoff_address);

        $offer->pickup_lat = $pickup['lat'] ?? null;
        $offer->pickup_lng = $pickup['lng'] ?? null;
        $offer->dropoff_lat = $dropoff['lat'] ?? null;
        $offer->dropoff_lng = $dropoff['lng'] ?? null;

        $offer->pickup_address = $this->normalizeDisplay($offer->pickup_address, $pickup['address'] ?? null);
        $offer->dropoff_address = $this->normalizeDisplay($offer->dropoff_address, $dropoff['address'] ?? null);

        if ($pickup && $dropoff) {
            $route = $this->route($pickup, $dropoff);
            $offer->distance_m = $route['distance_m'] ?? null;
            $offer->route_geometry = $route['geometry'] ?? null;
            $offer->geo_synced_at = CarbonImmutable::now(); // success — done for good
        } else {
            // Couldn't resolve both ends (transient rate-limit or unknown address).
            // Count the attempt and only give up after a few tries.
            $offer->geo_attempts = (int) $offer->geo_attempts + 1;
            if ($offer->geo_attempts >= self::MAX_ATTEMPTS) {
                $offer->geo_synced_at = CarbonImmutable::now();
            }
        }

        $offer->save();

        return $offer;
    }

    /** Address → {lat,lng}, cached in geocode_cache (dedupes across offers). */
    private function geocode(?string $address): ?array
    {
        // Strip any localised (non-Latin) country tail so Nominatim sees a clean
        // German address — this is what mixed-script offers were failing on.
        $address = (string) AddressNormalizer::clean($address);
        $address = trim($address);
        if ($address === '') {
            return null;
        }

        $cached = DB::table('geocode_cache')->where('query', $address)->first();
        if ($cached !== null) {
            if ($cached->lat === null) {
                return null;
            }
            $result = ['lat' => (float) $cached->lat, 'lng' => (float) $cached->lng];
            if (! empty($cached->label)) {
                $result['address'] = $cached->label; // unify to German even from cache
            }

            return $result;
        }

        try {
            $res = Http::withHeaders(['User-Agent' => self::UA])
                ->timeout(6)
                ->get($this->nominatimUrl(), [
                    'q' => $address,
                    'format' => 'json',
                    'limit' => 1,
                    'countrycodes' => 'de', // fleet is German — bias + speed up resolution
                    'accept-language' => 'de', // return the German address, not the driver's app locale
                    'addressdetails' => 1, // structured fields so we can build a short "street, PLZ city" label
                ]);
        } catch (\Throwable $e) {
            return null; // transient (timeout/network) — do NOT cache, so a retry can succeed
        }

        if (! $res->ok()) {
            return null; // transient (rate-limited 429 / 5xx) — do NOT cache, retry later
        }

        // Definitive 200 response: a hit, or a genuine "not found" worth caching so
        // we never re-query an address that truly doesn't resolve.
        $hit = $res->json()[0] ?? null;
        $coords = ($hit && isset($hit['lat'], $hit['lon']))
            ? ['lat' => (float) $hit['lat'], 'lng' => (float) $hit['lon']]
            : null;

        // A short, German, human-readable label ("street nr, PLZ city") unifies
        // the address to one language regardless of the captured session's locale.
        // Carried on the fresh result so enrich() can replace the localized text.
        if ($coords !== null) {
            $label = $this->shortGermanLabel($hit);
            if ($label !== null) {
                $coords['address'] = $label;
            }
        }

        // Atomic upsert (INSERT ... ON DUPLICATE KEY UPDATE): two requests geocoding
        // the same address concurrently would race a check-then-insert and trip the
        // unique key (1062). upsert lets the loser update instead of erroring.
        DB::table('geocode_cache')->upsert(
            [['query' => $address, 'lat' => $coords['lat'] ?? null, 'lng' => $coords['lng'] ?? null, 'label' => $coords['address'] ?? null, 'updated_at' => now(), 'created_at' => now()]],
            ['query'],
            ['lat', 'lng', 'label', 'updated_at'],
        );

        return $coords;
    }

    /**
     * Build a compact German address label from Nominatim's structured fields:
     * "Street 12, 44787 Bochum". Keeps only what a driver needs to recognise the
     * spot — street (+ house number) and the city with its postal code — instead
     * of the long "…, Nordrhein-Westfalen, Deutschland" display_name tail. Falls
     * back to whatever single part exists, then to display_name, then null.
     *
     * @param  array<string, mixed>|null  $hit
     */
    private function shortGermanLabel(?array $hit): ?string
    {
        $a = is_array($hit['address'] ?? null) ? $hit['address'] : [];

        // Street line: road/pedestrian/footway (+ house number), else a named place.
        $street = $a['road'] ?? $a['pedestrian'] ?? $a['footway'] ?? $a['neighbourhood'] ?? null;
        if ($street !== null && ! empty($a['house_number'])) {
            $street = "{$street} {$a['house_number']}";
        }

        // City line: the settlement, prefixed with its postal code when present.
        $city = $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? $a['suburb'] ?? null;
        if ($city !== null && ! empty($a['postcode'])) {
            $city = "{$a['postcode']} {$city}";
        }

        $label = trim(implode(', ', array_filter([$street, $city])));
        if ($label !== '') {
            return $label;
        }

        $display = $hit['display_name'] ?? null;

        return is_string($display) && $display !== '' ? $display : null;
    }

    /**
     * Decide the address a driver sees, given the original (from Uber) and the
     * geocoder's German label:
     *  - non-Latin original (Arabic/foreign) → replace wholesale, it's unreadable
     *    and doesn't match Uber anyway.
     *  - Latin original (Uber's own German) → keep the street exactly as Uber
     *    sent it and only guarantee the "PLZ City" tail is complete, so the two
     *    Uber variants ("…, 42117" vs "…, Wuppertal") both end up as "42117
     *    Wuppertal" without ever shifting the city.
     */
    private function normalizeDisplay(?string $original, ?string $germanLabel): ?string
    {
        if ($original === null || empty($germanLabel)) {
            return $original;
        }
        if (AddressNormalizer::hasNonLatinLetters($original)) {
            return $germanLabel;
        }

        return $this->ensureCity($original, $this->cityPart($germanLabel));
    }

    /** The "PLZ City" tail of a "Street Nr, PLZ City" label (last comma segment). */
    private function cityPart(string $label): ?string
    {
        $parts = array_map('trim', explode(',', $label));
        $tail = end($parts);

        return $tail !== false && $tail !== '' ? $tail : null;
    }

    /**
     * Ensure the address carries both the postal code and the city name, filling
     * in whichever half Uber omitted from the deterministic (PLZ ↔ city is 1:1 in
     * Germany) geocoded "PLZ City", without duplicating what is already there.
     */
    private function ensureCity(string $original, ?string $cityLabel): string
    {
        if ($cityLabel === null) {
            return $original;
        }

        // Split "42117 Wuppertal" → plz "42117", city "Wuppertal".
        [$plz, $city] = array_pad(explode(' ', $cityLabel, 2), 2, null);
        if ($plz !== null && ! ctype_digit($plz)) {
            [$plz, $city] = [null, $cityLabel]; // no leading postcode
        }
        if ($city === null || $city === '') {
            return $original;
        }

        // Work on the location tail (the last comma segment) only, and match the
        // city/PLZ as whole words. Searching the whole string by substring
        // corrupted addresses whose STREET name contains the city — "Berliner
        // Straße 12, 10115" would get the postcode spliced before the street
        // ("10115 Berliner Straße …") because "Berliner" contains "Berlin".
        $cityRe = '/\b'.preg_quote($city, '/').'\b/iu';
        $plzRe = $plz !== null ? '/\b'.preg_quote($plz, '/').'\b/u' : null;

        $segments = array_map('trim', explode(',', $original));
        $lastKey = count($segments) - 1;
        $tail = $segments[$lastKey];

        $tailHasCity = preg_match($cityRe, $tail) === 1;
        $tailHasPlz = $plzRe !== null && preg_match($plzRe, $tail) === 1;

        if ($tailHasCity && ($tailHasPlz || $plz === null)) {
            return $original; // tail already carries the location
        }

        if ($tailHasCity) {
            // City in the tail, postcode missing → put the PLZ in front of it.
            $segments[$lastKey] = (string) preg_replace($cityRe, "{$plz} {$city}", $tail, 1);

            return implode(', ', $segments);
        }

        if ($tailHasPlz) {
            // Postcode in the tail, city missing → append the city after it.
            $segments[$lastKey] = (string) preg_replace($plzRe, "{$plz} {$city}", $tail, 1);

            return implode(', ', $segments);
        }

        // No location in the tail → append the full "PLZ City".
        return rtrim($original, ', ').', '.$cityLabel;
    }

    /**
     * Road distance + route geometry via OSRM; falls back to a straight-line
     * haversine distance (no geometry) when OSRM is unreachable.
     *
     * @return array{distance_m: int|null, geometry: array|null}
     */
    private function route(array $from, array $to): array
    {
        try {
            $path = "{$from['lng']},{$from['lat']};{$to['lng']},{$to['lat']}";
            $res = Http::timeout(6)->get($this->osrmUrl().'/'.$path, [
                'overview' => 'full',
                'geometries' => 'geojson',
            ]);
            $route = $res->ok() ? ($res->json('routes.0') ?? null) : null;
            if ($route) {
                return [
                    'distance_m' => (int) round($route['distance']),
                    'geometry' => $route['geometry'] ?? null, // GeoJSON LineString [lng,lat]
                ];
            }
        } catch (\Throwable $e) {
            // fall through to haversine
        }

        return ['distance_m' => $this->haversine($from, $to), 'geometry' => null];
    }

    /** Straight-line distance in metres. */
    private function haversine(array $a, array $b): int
    {
        $r = 6371000;
        $dLat = deg2rad($b['lat'] - $a['lat']);
        $dLng = deg2rad($b['lng'] - $a['lng']);
        $h = sin($dLat / 2) ** 2 + cos(deg2rad($a['lat'])) * cos(deg2rad($b['lat'])) * sin($dLng / 2) ** 2;

        return (int) round($r * 2 * asin(min(1, sqrt($h))));
    }
}
