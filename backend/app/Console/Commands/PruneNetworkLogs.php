<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
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

        $deleted = DispatchNetworkLog::where('created_at', '<', $cutoff)->delete();

        $this->info("Pruned {$deleted} network-log entr(ies) older than {$this->option('hours')}h.");

        return self::SUCCESS;
    }
}
