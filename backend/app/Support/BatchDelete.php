<?php

namespace App\Support;

use Closure;
use Illuminate\Contracts\Database\Query\Builder as BuilderContract;

/**
 * Deletes a large row set in short, id-bounded batches instead of one statement.
 *
 * A single DELETE over hundreds of thousands of rows runs as one transaction:
 * long locks, a ballooning undo log and binlog, and write stalls for every tenant
 * sharing the table. Each batch here is its own short statement, so locks are
 * released between batches. Same shape as the admin network-log clear; works on
 * MySQL and SQLite.
 */
class BatchDelete
{
    /**
     * @param  Closure(): BuilderContract  $query  builds a FRESH query (Eloquent or base) for the rows to delete
     * @param  int  $maxBatches  0 = until done
     * @return int rows deleted
     */
    public static function run(Closure $query, int $batchSize = 2000, int $maxBatches = 0, int $pauseMicros = 0): int
    {
        $total = 0;
        $batches = 0;

        do {
            $ids = $query()->orderBy('id')->limit($batchSize)->pluck('id');
            if ($ids->isEmpty()) {
                break;
            }

            $deleted = $query()->whereIn('id', $ids->all())->delete();
            $total += $deleted;
            $batches++;

            if ($pauseMicros > 0 && $ids->count() === $batchSize) {
                usleep($pauseMicros);
            }
        } while ($ids->count() === $batchSize && ($maxBatches === 0 || $batches < $maxBatches));

        return $total;
    }
}
