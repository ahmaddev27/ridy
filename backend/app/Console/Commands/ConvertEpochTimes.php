<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\EpochTimeBackfill;
use Illuminate\Console\Command;

/**
 * Re-runs the one-off UTC → Berlin correction of Uber epoch times. The migration
 * already does it on deploy; run this only if a deploy rolled back to a release
 * that still wrote UTC times, once the fixed release is live again. Safe to repeat.
 */
class ConvertEpochTimes extends Command
{
    protected $signature = 'dispatch:convert-epoch-times';

    protected $description = 'Convert Uber epoch times still stored as UTC wall-clock to Europe/Berlin (idempotent).';

    public function handle(EpochTimeBackfill $backfill): int
    {
        $result = $backfill->run();

        $this->info("Converted {$result['offers']} offer(s) and {$result['metrics']} metric row(s).");

        return self::SUCCESS;
    }
}
