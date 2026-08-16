<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Turns an offer's pickup/dropoff addresses into map coordinates + a road route,
 * using only free services (Nominatim for geocoding, OSRM for routing). Results
 * are cached on the offer (and addresses in a shared geocode_cache) so the work
 * runs once, lazily, on first detail view.
 */
class TripGeocoder
{
    private const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

    private const OSRM = 'https://router.project-osrm.org/route/v1/driving';

    private const UA = 'Reidey/1.0 (fleet dispatch; contact: ops@reidey.de)';

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
        $address = trim((string) $address);
        if ($address === '') {
            return null;
        }

        $cached = DB::table('geocode_cache')->where('query', $address)->first();
        if ($cached !== null) {
            return $cached->lat !== null ? ['lat' => (float) $cached->lat, 'lng' => (float) $cached->lng] : null;
        }

        try {
            $res = Http::withHeaders(['User-Agent' => self::UA])
                ->timeout(6)
                ->get(self::NOMINATIM, [
                    'q' => $address,
                    'format' => 'json',
                    'limit' => 1,
                    'countrycodes' => 'de', // fleet is German — bias + speed up resolution
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

        DB::table('geocode_cache')->updateOrInsert(
            ['query' => $address],
            ['lat' => $coords['lat'] ?? null, 'lng' => $coords['lng'] ?? null, 'updated_at' => now(), 'created_at' => now()],
        );

        return $coords;
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
            $res = Http::timeout(6)->get(self::OSRM.'/'.$path, [
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
