<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use Illuminate\Console\Command;

/**
 * Geocodes offers whose lazy enrich hasn't succeeded yet (transient failures on
 * the free geocoding/routing services), so trip distance shows up without anyone
 * opening the detail view. A small batch per run, gently spaced, to respect the
 * ~1 req/sec Nominatim limit.
 */
class BackfillOfferGeo extends Command
{
    protected $signature = 'offers:backfill-geo {--limit=15} {--reset : Re-queue offers that already gave up but still have no distance}';

    protected $description = 'Retry trip geocoding for offers that are missing it.';

    public function handle(TripGeocoder $geocoder): int
    {
        // Recover offers that exhausted their attempts (geo_synced_at stamped) but
        // never got a distance, so the scheduled runs pick them up again.
        if ($this->option('reset')) {
            $requeued = DispatchOffer::withoutGlobalScopes()
                ->whereNull('distance_m')
                ->whereNotNull('geo_synced_at')
                ->update(['geo_synced_at' => null, 'geo_attempts' => 0]);
            $this->info("Re-queued {$requeued} stuck offer(s).");
        }

        $offers = DispatchOffer::withoutGlobalScopes()
            ->whereNull('geo_synced_at')
            ->whereNotNull('pickup_address')
            ->orderByDesc('received_at')
            ->limit((int) $this->option('limit'))
            ->get();

        $done = 0;
        foreach ($offers as $offer) {
            $geocoder->enrich($offer);
            if ($offer->geo_synced_at !== null && $offer->distance_m !== null) {
                $done++;
            }
            // Throttle so the background backfill never saturates the local
            // Nominatim (it returns 429 under a fast batch) — this leaves the
            // geocoder responsive for time-critical live offers.
            usleep(300_000); // 300ms
        }

        $this->info("Backfilled geo for {$done}/{$offers->count()} offer(s).");

        return self::SUCCESS;
    }
}
