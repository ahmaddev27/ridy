<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\TripGeocoder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Keep geocode_cache bounded.
 *
 * Nothing ever pruned it: every reverse lookup writes a row keyed to ~1 m
 * precision, so the table only grew, and a cached MISS stayed forever — which also
 * defeated `offers:backfill-geo --reset` (the re-queued offer hit the stored miss
 * and burned through its attempts again).
 *
 * Two retentions, deliberately different:
 *  - a MISS expires with {@see TripGeocoder::MISS_TTL_DAYS} — the data behind it
 *    changes, and re-asking costs one request;
 *  - a HIT is only dropped when it has gone untouched for a long time, because a
 *    resolved address is exactly what keeps the geocoder cheap.
 */
class PruneGeocodeCache extends Command
{
    protected $signature = 'geocode-cache:prune
        {--miss-days= : Delete unresolved entries older than this (default: TripGeocoder::MISS_TTL_DAYS)}
        {--hit-days=365 : Delete resolved entries untouched for this long}';

    protected $description = 'Drop stale geocode-cache entries (expired misses, long-unused hits).';

    public function handle(): int
    {
        $missDays = (int) ($this->option('miss-days') ?? 0) ?: TripGeocoder::MISS_TTL_DAYS;
        $hitDays = (int) $this->option('hit-days');

        $misses = DB::table('geocode_cache')
            ->whereNull('lat')
            ->where('updated_at', '<', now()->subDays($missDays))
            ->delete();

        $hits = DB::table('geocode_cache')
            ->whereNotNull('lat')
            ->where('updated_at', '<', now()->subDays($hitDays))
            ->delete();

        $this->info("Pruned {$misses} expired miss(es) and {$hits} unused hit(s).");

        return self::SUCCESS;
    }
}
