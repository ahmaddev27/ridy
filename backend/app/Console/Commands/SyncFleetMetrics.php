<?php

namespace App\Console\Commands;

use App\Domain\Fleet\FleetHub\FleetHubSessionResolver;
use App\Jobs\SyncTenantMetrics;
use Illuminate\Console\Command;

/**
 * Queue one per-driver metrics pull per eligible company (UBER_SERVER_SYNC
 * only), spread over a jitter window so ticks do not hit Uber all at once.
 */
class SyncFleetMetrics extends Command
{
    protected $signature = 'fleet:sync-metrics';

    protected $description = 'Queue a server-side Fleet Hub driver-metrics sync for every connected company.';

    private const JITTER_SECONDS = 120;

    public function handle(FleetHubSessionResolver $resolver): int
    {
        if (! config('services.uber.server_sync')) {
            $this->info('UBER_SERVER_SYNC is off; nothing queued.');

            return self::SUCCESS;
        }

        $tenants = $resolver->eligibleTenants();
        foreach ($tenants as $tenant) {
            SyncTenantMetrics::dispatch((int) $tenant->id)->delay(now()->addSeconds(random_int(0, self::JITTER_SECONDS)));
        }
        $this->info('Queued driver-metrics sync for '.$tenants->count().' companies.');

        return self::SUCCESS;
    }
}
