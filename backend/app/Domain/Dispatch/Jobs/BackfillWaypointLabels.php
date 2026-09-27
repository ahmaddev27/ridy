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

    /** Hard stop below the worker's 60 s timeout. */
    public int $timeout = 45;

    /** Points per job — each is a reverse geocode of up to 5 s. */
    public const MAX_POINTS = 8;

    /** Stop starting new lookups after this long, so the job ends before $timeout. */
    private const BUDGET_SECONDS = 35;

    /**
     * @param  array<int, array{0: float, 1: float}>  $points  [lat, lng] pairs
     */
    public function __construct(private readonly array $points) {}

    public function handle(TripGeocoder $geocoder): void
    {
        $deadline = microtime(true) + self::BUDGET_SECONDS;

        foreach (array_slice($this->points, 0, self::MAX_POINTS) as $point) {
            if (microtime(true) >= $deadline) {
                break; // the rest stay uncached; a later map poll re-enqueues them
            }
            // reverse() caches the resolved label in geocode_cache; the next map
            // poll picks it up via the batch cache lookup. A transient failure just
            // leaves it uncached for a later attempt.
            $geocoder->reverse((float) $point[0], (float) $point[1]);
        }
    }
}
