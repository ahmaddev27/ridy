<?php

namespace App\Domain\Fleet;

use App\Domain\Dispatch\Jobs\BackfillWaypointLabels;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Geo\PostalCodes;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;

/**
 * The live fleet map's data: one implementation shared by the dashboard
 * (DriverController::live) and the driver app's manager mode, so the two can
 * never drift apart. The tenant is passed explicitly where the caller has one.
 */
class LiveFleetPositions
{
    /** How long a cold waypoint label, once queued, isn't queued again. */
    private const LABEL_BACKFILL_COOLDOWN_SECONDS = 120;

    public function __construct(private TripGeocoder $geo) {}

    /**
     * Drivers with a live position for the fleet map. Only engaged drivers
     * (EN_ROUTE / ON_TRIP) have real coordinates — Uber redacts idle/offline
     * drivers to 0,0, which the ingestor stores as null — so the map naturally
     * shows only active trips, each with its pickup/dropoff waypoints.
     */
    /** @return array<int, array<string, mixed>> */
    public function forTenant(?int $tenantId): array
    {
        $geo = $this->geo;
        // Only show genuinely-live positions: a driver whose status hasn't been
        // synced within this window (dead session / closed extension) must drop
        // off the map instead of freezing in place and looking live.
        $freshSince = now()->subMinutes(Driver::LIVE_STALE_MINUTES);

        $liveDrivers = $this->driverQuery($tenantId)
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            // Belt-and-suspenders with the ingestor's bounds check: never plot a
            // fix outside a generous Germany/DACH box, so a bad coordinate already
            // stored (from before the ingest guard) is hidden immediately instead
            // of waiting for the next status sync to overwrite it.
            ->whereBetween('latitude', [45.0, 56.0])
            ->whereBetween('longitude', [4.0, 17.0])
            ->where('status_synced_at', '>=', $freshSince)
            ->get();

        // Resolve every waypoint's street label from a SINGLE geocode_cache query
        // (not one per waypoint per driver) and NEVER hit the network in this
        // user-facing poll: cold points fall back to the nearest town and are
        // reverse-geocoded out-of-band so the label appears on a later poll.
        $allPoints = [];
        foreach ($liveDrivers as $d) {
            foreach ($d->trip_waypoints ?? [] as $w) {
                $allPoints[] = [(float) ($w['lat'] ?? 0), (float) ($w['lng'] ?? 0)];
            }
        }
        $cachedLabels = $geo->cachedReverseLabels($allPoints);

        $misses = [];
        // Nearest-town lookups memoised per request: drivers and their waypoints
        // often share a point (same pickup, same station), so each is computed once.
        $towns = [];
        $nearest = function (float $lat, float $lng) use (&$towns): ?array {
            $key = round($lat, 3).','.round($lng, 3);

            return $towns[$key] ??= PostalCodes::nearest($lat, $lng);
        };

        $drivers = $liveDrivers->map(function (Driver $d) use ($geo, $cachedLabels, &$misses, $nearest) {
            // Reverse the live GPS to the nearest town so the fleet map can show
            // where each driver currently is (updates every poll).
            $near = $nearest((float) $d->latitude, (float) $d->longitude);

            return [
                'id' => $d->id,
                'name' => $d->name,
                'phone' => $d->phone,
                'city' => $near['city'] ?? null,
                'plz' => $near['plz'] ?? null,
                'picture' => $d->uber_picture_url,
                'status' => $d->online_status,
                'lat' => (float) $d->latitude,
                'lng' => (float) $d->longitude,
                'heading' => $d->heading !== null ? (float) $d->heading : null,
                // Label each pickup/dropoff from the batched cache; the nearest town
                // is the always-available fallback while a cold point is backfilled.
                'waypoints' => collect($d->trip_waypoints ?? [])->map(function ($w) use ($geo, $cachedLabels, &$misses, $nearest) {
                    $lat = (float) ($w['lat'] ?? 0);
                    $lng = (float) ($w['lng'] ?? 0);
                    $near = $nearest($lat, $lng);
                    $key = $geo->reverseCacheKey($lat, $lng);
                    $address = $key !== null ? ($cachedLabels[$key] ?? null) : null;
                    if ($key !== null && $address === null) {
                        $misses[$key] = [$lat, $lng]; // dedupe cold points by cache key
                    }

                    return array_merge($w, [
                        'address' => $address,
                        'city' => $near['city'] ?? null,
                        'plz' => $near['plz'] ?? null,
                    ]);
                })->all(),
                'location_updated_at' => $d->location_updated_at,
                'is_manager' => (bool) $d->is_manager,
            ];
        });

        // Fill cold labels off the request path so the next poll serves them warm.
        // Each cold point is queued ONCE per couple of minutes, not by every open
        // dashboard on every 12 s poll (a Nominatim outage used to flood the queue).
        $fresh = array_values(array_filter(
            $misses,
            fn ($key) => Cache::add('revgeo:inflight:'.$key, 1, self::LABEL_BACKFILL_COOLDOWN_SECONDS),
            ARRAY_FILTER_USE_KEY,
        ));
        foreach (array_chunk($fresh, BackfillWaypointLabels::MAX_POINTS) as $chunk) {
            BackfillWaypointLabels::dispatch($chunk);
        }

        return $drivers->all();
    }

    /** An explicit tenant bypasses the request-context scope; null keeps the ambient scope. */
    private function driverQuery(?int $tenantId): Builder
    {
        return $tenantId === null
            ? Driver::query()
            : Driver::withoutGlobalScopes()->where('tenant_id', $tenantId);
    }
}
