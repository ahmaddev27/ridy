<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;

/**
 * Keep the dispatch network log (admin Network tab) bounded — status syncs are
 * frequent, so rows older than the retention window are dropped hourly.
 */
class PruneNetworkLogs extends Command
{
    protected $signature = 'network-logs:prune {--hours=48 : Delete entries older than this} {--status-hours=6 : Delete status-sync entries older than this}';

    protected $description = 'Delete dispatch network-log entries past the retention window.';

    public function handle(): int
    {
        $cutoff = now()->subHours((int) $this->option('hours'));
        // Status rows are the bulk of the table and only feed live debugging, so
        // they are kept for less time ("detect, don't surveil").
        $statusCutoff = now()->subHours(min((int) $this->option('hours'), (int) $this->option('status-hours')));

        // Chunked by id: one huge DELETE of large JSON rows held a long transaction
        // (undo/binlog spikes, lock waits) against the continuous inserts.
        $deleted = $this->purge(DispatchNetworkLog::query()->where('kind', 'status')->where('created_at', '<', $statusCutoff))
            + $this->purge(DispatchNetworkLog::query()->where('created_at', '<', $cutoff));

        $this->info("Pruned {$deleted} network-log entr(ies) older than {$this->option('hours')}h.");

        return self::SUCCESS;
    }

    private function purge(Builder $query): int
    {
        $deleted = 0;
        do {
            $ids = (clone $query)->limit(5000)->pluck('id');
            if ($ids->isNotEmpty()) {
                $deleted += DispatchNetworkLog::whereIn('id', $ids)->delete();
            }
        } while ($ids->count() === 5000);

        return $deleted;
    }
}
