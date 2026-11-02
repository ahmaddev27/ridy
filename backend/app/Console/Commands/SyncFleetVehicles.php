<?php

namespace App\Console\Commands;

use App\Domain\Fleet\FleetHub\FleetHubSessionResolver;
use App\Jobs\SyncTenantVehicles;
use Illuminate\Console\Command;

/**
 * Queue one vehicles pull per eligible company (UBER_SERVER_SYNC only), spread
 * over a jitter window like {@see SyncFleetEarnings}.
 */
class SyncFleetVehicles extends Command
{
    protected $signature = 'fleet:sync-vehicles';

    protected $description = 'Queue a server-side Fleet Hub vehicles sync for every connected company.';

    private const JITTER_SECONDS = 300;

    public function handle(FleetHubSessionResolver $resolver): int
    {
        if (! config('services.uber.server_sync')) {
            $this->info('UBER_SERVER_SYNC is off; nothing queued.');

            return self::SUCCESS;
        }

        $tenants = $resolver->eligibleTenants();
        foreach ($tenants as $tenant) {
            SyncTenantVehicles::dispatch((int) $tenant->id)->delay(now()->addSeconds(random_int(0, self::JITTER_SECONDS)));
        }
        $this->info('Queued vehicles sync for '.$tenants->count().' companies.');

        return self::SUCCESS;
    }
}
