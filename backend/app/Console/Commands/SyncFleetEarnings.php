<?php

namespace App\Console\Commands;

use App\Domain\Fleet\FleetHub\FleetHubSessionResolver;
use App\Jobs\SyncTenantEarnings;
use Illuminate\Console\Command;

/**
 * Queue one earnings pull per eligible company (UBER_SERVER_SYNC only). The
 * jobs are spread over a jitter window so one tick does not hit Uber, or the
 * shared proxy pool, all at once.
 */
class SyncFleetEarnings extends Command
{
    protected $signature = 'fleet:sync-earnings';

    protected $description = 'Queue a server-side Fleet Hub earnings sync for every connected company.';

    private const JITTER_SECONDS = 45;

    public function handle(FleetHubSessionResolver $resolver): int
    {
        if (! config('services.uber.server_sync')) {
            $this->info('UBER_SERVER_SYNC is off; nothing queued.');

            return self::SUCCESS;
        }

        $tenants = $resolver->eligibleTenants();
        foreach ($tenants as $tenant) {
            SyncTenantEarnings::dispatch((int) $tenant->id)->delay(now()->addSeconds(random_int(0, self::JITTER_SECONDS)));
        }
        $this->info('Queued earnings sync for '.$tenants->count().' companies.');

        return self::SUCCESS;
    }
}
