<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\OfferLifecycle;
use Illuminate\Console\Command;

/**
 * Force-finalizes offers that slipped past an unobserved driver-status edge:
 * STARTED trips longer than the max trip length are completed, and ACCEPTED
 * offers that never started are canceled. The status poll does this per active
 * tenant; this covers tenants whose daemon is idle. Schedule every few minutes.
 */
class FinalizeStaleOffers extends Command
{
    protected $signature = 'offers:finalize-stale';

    protected $description = 'Force-complete over-long trips and cancel abandoned accepted offers.';

    public function handle(OfferLifecycle $lifecycle): int
    {
        $count = $lifecycle->finalizeStale();
        $this->info("Finalized {$count} stale offer(s).");

        return self::SUCCESS;
    }
}
