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
    protected $signature = 'offers:backfill-geo {--limit=15}';

    protected $description = 'Retry trip geocoding for offers that are missing it.';

    public function handle(TripGeocoder $geocoder): int
    {
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
            usleep(1_100_000); // ~1.1s between offers — under Nominatim's rate limit
        }

        $this->info("Backfilled geo for {$done}/{$offers->count()} offer(s).");

        return self::SUCCESS;
    }
}
