<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\TripGeocoder;
use App\Support\BatchDelete;
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
 *  - a HIT is dropped once it is older than --hit-days. Cache hits do not touch
 *    updated_at, so this is AGE since the lookup was stored/refreshed, not time
 *    since last use. The table holds no tenant or person key.
 *
 * Deletes run in short id-bounded batches (an index on updated_at bounds each
 * scan), so live-offer geocode upserts never queue behind one long DELETE.
 */
class PruneGeocodeCache extends Command
{
    protected $signature = 'geocode-cache:prune
        {--miss-days= : Delete unresolved entries older than this (default: TripGeocoder::MISS_TTL_DAYS)}
        {--hit-days=365 : Delete resolved entries stored/refreshed longer ago than this}';

    protected $description = 'Drop stale geocode-cache entries (expired misses, old hits).';

    public function handle(): int
    {
        $missDays = (int) ($this->option('miss-days') ?? 0) ?: TripGeocoder::MISS_TTL_DAYS;
        $hitDays = (int) $this->option('hit-days');

        $misses = BatchDelete::run(fn () => DB::table('geocode_cache')
            ->whereNull('lat')
            ->where('updated_at', '<', now()->subDays($missDays)), 1000);

        $hits = BatchDelete::run(fn () => DB::table('geocode_cache')
            ->whereNotNull('lat')
            ->where('updated_at', '<', now()->subDays($hitDays)), 1000);

        $this->info("Pruned {$misses} expired miss(es) and {$hits} old hit(s).");

        return self::SUCCESS;
    }
}
