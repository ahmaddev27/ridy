<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\DispatchCommandQueue;
use Illuminate\Console\Command;

/**
 * Settles dispatch commands whose window closed while they were still open — one
 * no daemon collected, or one a box claimed and then died without reporting.
 *
 * Without it such a row stays queued/claimed forever: the driver's pop-up keeps
 * waiting on an answer that is never coming, and the row pollutes the latency
 * measurement this table exists to produce. Schedule it every minute.
 */
class ExpireDispatchCommands extends Command
{
    protected $signature = 'dispatch:expire-commands';

    protected $description = 'Mark dispatch commands whose offer window elapsed as expired.';

    public function handle(DispatchCommandQueue $queue): int
    {
        $count = $queue->expireStale();
        $this->info("Expired {$count} dispatch command(s).");

        return self::SUCCESS;
    }
}
