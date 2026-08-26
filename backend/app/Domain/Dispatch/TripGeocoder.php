<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Geo\PostalCodes;
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

        // Bias ambiguous (postcode-less) addresses to where the trip actually is:
        // the driver's last known position for the pickup, then the resolved
        // pickup for the dropoff (a dispatch trip's ends are close together).
        $driver = $offer->driver_id !== null
            ? Driver::withoutGlobalScopes()->find($offer->driver_id)
            : null;
        $dLat = $driver?->latitude !== null ? (float) $driver->latitude : null;
        $dLng = $driver?->longitude !== null ? (float) $driver->longitude : null;

        $pickup = $this->geocode($offer->pickup_address, $dLat, $dLng);
        $dropoff = $this->geocode($offer->dropoff_address, $pickup['lat'] ?? $dLat, $pickup['lng'] ?? $dLng);

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
            $offer->geo_confidence = $this->combinedConfidence($pickup['confidence'] ?? null, $dropoff['confidence'] ?? null, $route);
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

    /**
     * Address → {lat,lng}, cached in geocode_cache (dedupes across offers).
     *
     * When the address has no German postcode it is ambiguous — the same street
     * name exists in dozens of towns, so Nominatim can resolve it to one 500 km
     * away and blow up the distance/€-per-km. If a bias point is supplied (the
     * driver's live position, or the already-resolved pickup) the lookup is
     * restricted to a box around it so the result stays in the trip's region.
     */
    private function geocode(?string $address, ?float $biasLat = null, ?float $biasLng = null): ?array
    {
        // Strip any localised (non-Latin) country tail so Nominatim sees a clean
        // German address — this is what mixed-script offers were failing on.
        $address = (string) AddressNormalizer::clean($address);
        $address = trim($address);
        if ($address === '') {
            return null;
        }

        // A 5-digit postcode makes the address unambiguous; without one, bias to
        // the supplied region when we have it.
        $ambiguous = preg_match('/\b\d{5}\b/', $address) !== 1;
        $useBias = $ambiguous && $biasLat !== null && $biasLng !== null;

        // A biased ambiguous result depends on the region, so fold the (coarse)
        // region into the cache key; a postcode-qualified address stays globally
        // cached and shared across drivers.
        $cacheKey = $useBias
            ? $address.'|@'.round($biasLat, 1).','.round($biasLng, 1)
            : $address;

        $cached = DB::table('geocode_cache')->where('query', $cacheKey)->first();
        if ($cached !== null) {
            if ($cached->lat === null) {
                return null;
            }
            $result = ['lat' => (float) $cached->lat, 'lng' => (float) $cached->lng];
            if (! empty($cached->label)) {
                $result['address'] = $cached->label; // unify to German even from cache
            }
            if (! empty($cached->confidence)) {
                $result['confidence'] = $cached->confidence;
            }

            return $result;
        }

        // Resolve through a precision cascade, stopping at the first tier that
        // returns a point and recording its confidence. Structured Nominatim
        // params (street/postalcode/city) are far more robust to Uber's garbled
        // free-text than a single `q`. A transient failure (network / rate-limit)
        // aborts WITHOUT caching so a later call retries instead of caching a miss.
        $parsed = AddressNormalizer::parse($address);
        $plz = $parsed['plz'];
        // Prefer the authoritative PLZ→city (1:1 in Germany) over Uber's parse.
        $city = $plz !== null ? (PostalCodes::city($plz) ?? $parsed['city']) : $parsed['city'];
        $street = $parsed['street'];

        $base = [
            'format' => 'json',
            'limit' => 1,
            'countrycodes' => 'de', // fleet is German — bias + speed up resolution
            'accept-language' => 'de', // return the German address, not the driver's app locale
            'addressdetails' => 1, // structured fields for the short "street, PLZ city" label
        ];

        $coords = null;

        // Tier 1 — street + PLZ + city (structured). House number → exact, else street.
        if ($coords === null && $street !== null && $plz !== null && $city !== null) {
            $r = $this->queryNominatim($base + ['street' => $street, 'postalcode' => $plz, 'city' => $city]);
            if ($r['transient']) {
                return null;
            }
            if ($r['hit'] !== null) {
                $coords = $this->fromHit($r['hit'], preg_match('/\d/', $street) === 1 ? 'exact' : 'street');
            }
        }

        // Tier 2 — PLZ + city, no street. A street-less "PLZ City" is usually a
        // station pickup/dropoff, so try the town's Bahnhof first, then the town.
        if ($coords === null && $plz !== null && $city !== null) {
            $st = $this->queryNominatim($base + ['q' => 'Bahnhof, '.$plz.' '.$city]);
            if ($st['transient']) {
                return null;
            }
            if ($st['hit'] !== null && $this->isStation($st['hit'])) {
                $coords = $this->fromHit($st['hit'], 'area');
                $coords['address'] = 'Bahnhof, '.$plz.' '.$city;
            } else {
                $r = $this->queryNominatim($base + ['postalcode' => $plz, 'city' => $city]);
                if ($r['transient']) {
                    return null;
                }
                if ($r['hit'] !== null) {
                    $coords = $this->fromHit($r['hit'], 'area');
                }
            }
        }

        // Tier 3 — PLZ centroid from the static table (network-free safety net).
        if ($coords === null && $plz !== null) {
            $coords = $this->plzCentroidFallback($address);
            if ($coords !== null) {
                $coords['confidence'] = 'postal';
            }
        }

        // Tier 4 — postcode-less free text, biased to the trip's region when we
        // have a bias point (otherwise the same street name resolves 500 km away).
        if ($coords === null && $plz === null) {
            $params = $base + ['q' => $address];
            if ($useBias) {
                $d = 0.45; // ~50 km half-box; bounded=1 keeps the result inside it
                $params['viewbox'] = ($biasLng - $d).','.($biasLat - $d).','.($biasLng + $d).','.($biasLat + $d);
                $params['bounded'] = 1;
            }
            $r = $this->queryNominatim($params);
            if ($r['transient']) {
                return null;
            }
            if ($r['hit'] !== null) {
                $coords = $this->fromHit($r['hit'], 'approx');
            }
        }

        // Atomic upsert (INSERT ... ON DUPLICATE KEY UPDATE): two requests geocoding
        // the same address concurrently would race a check-then-insert and trip the
        // unique key (1062). upsert lets the loser update instead of erroring. A
        // definitive miss ($coords null) is cached too, so it isn't re-queried.
        DB::table('geocode_cache')->upsert(
            [['query' => $cacheKey, 'lat' => $coords['lat'] ?? null, 'lng' => $coords['lng'] ?? null, 'label' => $coords['address'] ?? null, 'confidence' => $coords['confidence'] ?? null, 'updated_at' => now(), 'created_at' => now()]],
            ['query'],
            ['lat', 'lng', 'label', 'confidence', 'updated_at'],
        );

        return $coords;
    }

    /**
     * The trip's overall geo confidence: the weaker of the two endpoints (a
     * distance is only as trustworthy as its worse point). Downgraded to
     * `estimated` when the route has no road geometry — OSRM was unreachable, so
     * the distance is a straight-line haversine estimate.
     *
     * @param  array{geometry: mixed}  $route
     */
    private function combinedConfidence(?string $pickup, ?string $dropoff, array $route): string
    {
        $rank = ['exact' => 5, 'street' => 4, 'area' => 3, 'postal' => 2, 'approx' => 1];
        $worst = min($rank[$pickup] ?? 1, $rank[$dropoff] ?? 1);
        $confidence = array_search($worst, $rank, true) ?: 'approx';

        return ($route['geometry'] ?? null) === null ? 'estimated' : $confidence;
    }

    /**
     * One Nominatim call. Returns {transient, hit}: `transient` true on a
     * network/timeout/non-200 (caller must abort without caching so a retry can
     * still succeed); `hit` is the first result with coordinates, or null for a
     * definitive "not found".
     *
     * @param  array<string, mixed>  $params
     * @return array{transient: bool, hit: array<string, mixed>|null}
     */
    private function queryNominatim(array $params): array
    {
        try {
            $res = Http::withHeaders(['User-Agent' => self::UA])
                ->timeout(6)
                ->get($this->nominatimUrl(), $params);
        } catch (\Throwable $e) {
            return ['transient' => true, 'hit' => null];
        }

        if (! $res->ok()) {
            return ['transient' => true, 'hit' => null];
        }

        $hit = $res->json()[0] ?? null;

        return ['transient' => false, 'hit' => ($hit && isset($hit['lat'], $hit['lon'])) ? $hit : null];
    }

    /**
     * A resolved coordinate from a Nominatim hit, tagged with its confidence and a
     * short German label.
     *
     * @param  array<string, mixed>  $hit
     * @return array{lat: float, lng: float, confidence: string, address?: string}
     */
    private function fromHit(array $hit, string $confidence): array
    {
        $result = ['lat' => (float) $hit['lat'], 'lng' => (float) $hit['lon'], 'confidence' => $confidence];
        $label = $this->shortGermanLabel($hit);
        if ($label !== null) {
            $result['address'] = $label;
        }

        return $result;
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
    /**
     * True when a Nominatim hit is a railway station/stop — used to confirm a
     * street-less "PLZ City" address really resolved to the town's Bahnhof before
     * we label it as one.
     *
     * @param  array<string, mixed>|null  $hit
     */
    private function isStation(?array $hit): bool
    {
        if ($hit === null) {
            return false;
        }
        $class = strtolower((string) ($hit['class'] ?? ''));
        $type = strtolower((string) ($hit['type'] ?? ''));
        $name = strtolower((string) ($hit['display_name'] ?? ''));

        return ($class === 'railway' && in_array($type, ['station', 'halt', 'stop'], true))
            || str_contains($name, 'bahnhof');
    }

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

        // Prefer the authoritative city from the static PLZ table (PLZ ↔ city is
        // 1:1 in Germany) so the tail is filled correctly even when Nominatim's
        // label disagrees; fall back to the geocoder's own city part.
        return $this->ensureCity($original, $this->authoritativeCity($original) ?? $this->cityPart($germanLabel));
    }

    /**
     * The town centroid for an address's PLZ, or null when it has no valid PLZ or
     * the code is unknown. Labelled with the authoritative "PLZ City".
     *
     * @return array{lat: float, lng: float, address?: string}|null
     */
    private function plzCentroidFallback(string $address): ?array
    {
        if (preg_match('/\b(\d{5})\b/', $address, $m) !== 1) {
            return null;
        }
        $centroid = PostalCodes::centroid($m[1]);
        if ($centroid === null) {
            return null;
        }

        $result = ['lat' => $centroid['lat'], 'lng' => $centroid['lng']];
        $city = PostalCodes::city($m[1]);
        if ($city !== null) {
            $result['address'] = "{$m[1]} {$city}";
        }

        return $result;
    }

    /** The authoritative "PLZ City" for an address's PLZ, from the static table. */
    private function authoritativeCity(string $address): ?string
    {
        if (preg_match('/\b(\d{5})\b/', $address, $m) !== 1) {
            return null;
        }
        $city = PostalCodes::city($m[1]);

        return $city !== null ? "{$m[1]} {$city}" : null;
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
