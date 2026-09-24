<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\AddressNormalizer;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

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
            $this->reset();
        }

        // Skip offers still inside the live path (ingest enrich + GeocodeOffer's
        // 3 tries x 15 s): the backfill would double-geocode them against the same
        // rate-limited Nominatim.
        $offers = DispatchOffer::withoutGlobalScopes()
            ->whereNull('geo_synced_at')
            ->whereNotNull('pickup_address')
            ->where('received_at', '<', now()->subMinutes(2))
            ->orderByDesc('received_at')
            ->limit((int) $this->option('limit'))
            ->get();

        $done = 0;
        foreach ($offers as $offer) {
            // The 700 ms throttle leaves the batch stale: re-read so a concurrent
            // result is not overwritten and geo_attempts is not lost.
            $offer->refresh();
            if ($offer->geo_synced_at !== null) {
                continue;
            }
            $geocoder->enrich($offer);
            if ($offer->geo_synced_at !== null && $offer->distance_m !== null) {
                $done++;
            }
            // Throttle so the background backfill never saturates the local
            // Nominatim (it returns 429 under a fast batch) — this leaves the
            // geocoder responsive for time-critical live offers. A full stop each
            // offer (both ends geocode inside enrich) keeps the sustained rate well
            // under 1 req/sec, so a scheduled sweep can't starve a live offer.
            usleep(700_000); // 700ms
        }

        $this->info("Backfilled geo for {$done}/{$offers->count()} offer(s).");

        return self::SUCCESS;
    }

    /**
     * Recover offers that exhausted their attempts (geo_synced_at stamped) but never
     * got a distance, in id-paged chunks: one whereIn over the whole backlog blew
     * MySQL's 65,535-placeholder limit.
     */
    private function reset(): void
    {
        $requeued = 0;
        $cleared = 0;

        DispatchOffer::withoutGlobalScopes()
            ->whereNull('distance_m')
            ->whereNotNull('geo_synced_at')
            ->select(['id', 'pickup_address', 'dropoff_address'])
            ->chunkById(1000, function ($chunk) use (&$requeued, &$cleared) {
                $requeued += DispatchOffer::withoutGlobalScopes()
                    ->whereIntegerInRaw('id', $chunk->pluck('id')->all())
                    ->update(['geo_synced_at' => null, 'geo_attempts' => 0]);

                $cleared += $this->clearCachedMisses($chunk);
            });

        $this->info("Re-queued {$requeued} stuck offer(s); cleared {$cleared} cached miss(es).");
    }

    /**
     * Clearing the offer's attempts is not enough on its own: geocode() caches a
     * definitive miss, so a re-queued offer would hit that row, resolve nothing and
     * burn straight back through MAX_ATTEMPTS. Drop the cached MISSES (rows with no
     * coordinates) for the addresses involved — successful entries are left alone,
     * they are what makes this cheap.
     */
    private function clearCachedMisses(Collection $offers): int
    {
        $addresses = $offers
            ->flatMap(fn ($o) => [$o->pickup_address, $o->dropoff_address])
            ->filter()
            ->map(fn (string $a) => trim((string) AddressNormalizer::clean($a)))
            ->filter()
            ->unique()
            ->values();

        $cleared = 0;
        foreach ($addresses->chunk(200) as $chunk) {
            $cleared += DB::table('geocode_cache')
                ->whereNull('lat')
                ->where(function ($q) use ($chunk) {
                    foreach ($chunk as $address) {
                        // Bias-qualified keys are "<address>|@lat,lng" — clear those too.
                        $q->orWhere('query', $address)->orWhere('query', 'like', $address.'|@%');
                    }
                })
                ->delete();
        }

        return $cleared;
    }
}
