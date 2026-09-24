<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Support\BatchDelete;
use Illuminate\Console\Command;

/**
 * Keep the dispatch network log (admin Network tab) bounded — status syncs are
 * frequent, so rows older than the retention window are dropped hourly.
 */
class PruneNetworkLogs extends Command
{
    protected $signature = 'network-logs:prune {--hours=48 : Delete entries older than this}';

    protected $description = 'Delete dispatch network-log entries past the retention window.';

    public function handle(): int
    {
        $cutoff = now()->subHours((int) $this->option('hours'));

        // Id-bounded batches: after a scheduler outage or a retention change this
        // could be days of the busiest table, and one DELETE would lock it against
        // the live status ingest for the whole run.
        $deleted = BatchDelete::run(
            fn () => DispatchNetworkLog::query()->where('created_at', '<', $cutoff),
            batchSize: 5000,
            pauseMicros: 100_000,
        );

        $this->info("Pruned {$deleted} network-log entr(ies) older than {$this->option('hours')}h.");

        return self::SUCCESS;
    }
}
