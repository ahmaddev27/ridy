<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Garbage-collect the database cache store.
 *
 * Laravel's DatabaseStore deletes an expired row only when that same key is read
 * again, and there is no cache:prune for it. Keys that are never re-read — per-IP
 * throttle counters, one-off lookups — therefore stayed in `cache` / `cache_locks`
 * forever, growing the tables every dashboard request touches. Deleting in small
 * batches keeps each statement short on the live MySQL table.
 */
class PruneExpiredCache extends Command
{
    protected $signature = 'cache:prune-expired {--batch=1000 : Rows deleted per statement}';

    protected $description = 'Delete expired rows from the database cache and cache-lock tables.';

    public function handle(): int
    {
        $batch = max(1, (int) $this->option('batch'));
        $now = now()->getTimestamp();

        // lock_table is null unless DB_CACHE_LOCK_TABLE is set (Laravel then uses cache_locks).
        $cache = $this->prune((string) (config('cache.stores.database.table') ?: 'cache'), $now, $batch);
        $locks = $this->prune((string) (config('cache.stores.database.lock_table') ?: 'cache_locks'), $now, $batch);

        $this->info("Pruned {$cache} expired cache row(s) and {$locks} expired lock(s).");

        return self::SUCCESS;
    }

    private function prune(string $table, int $now, int $batch): int
    {
        $total = 0;

        do {
            $deleted = DB::table($table)->where('expiration', '<=', $now)->limit($batch)->delete();
            $total += $deleted;
        } while ($deleted === $batch);

        return $total;
    }
}
