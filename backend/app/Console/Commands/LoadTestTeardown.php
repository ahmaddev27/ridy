<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;

/**
 * Removes everything created by `loadtest:seed` — the load-test tenant and all
 * its offers, drivers, device tokens and session. Scoped strictly to the
 * load-test org so it can never delete a real tenant's data.
 */
class LoadTestTeardown extends Command
{
    protected $signature = 'loadtest:teardown {--force : allow in production}';

    protected $description = 'Delete the dispatch-pipeline load-test fixture';

    public function handle(): int
    {
        if ($this->getLaravel()->isProduction() && ! $this->option('force')) {
            $this->error('Refusing to run in production without --force.');

            return self::FAILURE;
        }

        $tenant = Tenant::where('name', LoadTestSeed::TENANT_NAME)->first();

        if ($tenant === null) {
            $this->info('No load-test fixture found.');

            return self::SUCCESS;
        }

        // Children first (global scopes off — the command runs with no tenant context).
        DispatchOffer::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
        DeviceToken::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
        Driver::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
        UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
        $tenant->delete();

        $this->info("Removed load-test fixture (tenant #{$tenant->id}).");

        return self::SUCCESS;
    }
}
