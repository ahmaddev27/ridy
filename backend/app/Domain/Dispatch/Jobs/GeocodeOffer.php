<?php

namespace App\Domain\Dispatch\Jobs;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Geocodes an offer's pickup/dropoff (distance + route) off the ingest hot path.
 * The offer is already stored and the driver already notified — this only fills
 * the dashboard's trip detail, so it runs async on the queue instead of holding
 * the daemon's ingest request open on a slow external geocode. The 5-minute
 * backfill sweep is the safety net if the job fails or the queue is down.
 */
class GeocodeOffer implements ShouldQueue
{
    use Queueable;

    /** Retry a couple times (transient Nominatim/OSRM failures), then give up. */
    public int $tries = 3;

    public int $backoff = 15;

    public function __construct(private readonly int $offerId) {}

    public function handle(TripGeocoder $geocoder): void
    {
        // Re-fetch without the tenant scope: the queue worker has no tenant
        // context, and enrich() only reads/writes this one row + the shared
        // geocode_cache. A deleted offer (company wiped) just no-ops.
        $offer = DispatchOffer::withoutGlobalScopes()->find($this->offerId);
        if ($offer !== null && $offer->geo_synced_at === null) {
            $geocoder->enrich($offer);
        }
    }
}
