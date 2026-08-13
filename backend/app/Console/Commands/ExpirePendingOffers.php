<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\OfferLifecycle;
use Illuminate\Console\Command;

/**
 * Sweeps pending offers whose accept window has elapsed to REJECTED. The status
 * poll already does this opportunistically per tenant; this covers tenants whose
 * daemon is idle. Schedule it every minute.
 */
class ExpirePendingOffers extends Command
{
    protected $signature = 'offers:expire-pending';

    protected $description = 'Mark pending offers whose accept window elapsed as rejected.';

    public function handle(OfferLifecycle $lifecycle): int
    {
        $count = $lifecycle->expirePending();
        $this->info("Expired {$count} pending offer(s).");

        return self::SUCCESS;
    }
}
