<?php

namespace App\Domain\Dispatch\Jobs;

use App\Domain\Dispatch\TripGeocoder;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Reverse-geocodes a small set of live-map waypoints off the request path. The
 * fleet-map endpoint only reads cached labels; when a driver's position shifts to
 * an un-cached point, it enqueues this job so the label is resolved (and cached)
 * out-of-band and shows up on the next poll — never blocking the user-facing GET
 * on a synchronous Nominatim call.
 */
class BackfillWaypointLabels implements ShouldQueue
{
    use Queueable;

    /** Transient Nominatim hiccups self-heal on the next poll — a light retry is enough. */
    public int $tries = 2;

    public int $backoff = 15;

    /**
     * @param  array<int, array{0: float, 1: float}>  $points  [lat, lng] pairs
     */
    public function __construct(private readonly array $points) {}

    public function handle(TripGeocoder $geocoder): void
    {
        foreach ($this->points as $point) {
            // reverse() caches the resolved label in geocode_cache; the next map
            // poll picks it up via the batch cache lookup. A transient failure just
            // leaves it uncached for a later attempt.
            $geocoder->reverse((float) $point[0], (float) $point[1]);
        }
    }
}
