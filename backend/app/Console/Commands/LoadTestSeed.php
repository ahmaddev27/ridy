<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * Provisions an isolated fixture for the dispatch-pipeline load test: a tenant
 * with an ACTIVE Uber fleet session (its org uuid is the ingest routing key),
 * plus N linked drivers each with a device token — so offers streamed at the
 * internal ingest endpoint match a driver and exercise the full path (store →
 * geocode → push → queue). Remove it afterwards with `loadtest:teardown`.
 *
 * Refuses to run in production unless --force is given, and never touches real
 * tenants — everything it creates is tagged with the load-test org uuid.
 */
class LoadTestSeed extends Command
{
    protected $signature = 'loadtest:seed {--drivers=50 : how many linked drivers to create} {--force : allow in production}';

    protected $description = 'Seed an isolated tenant + session + drivers for the dispatch pipeline load test';

    public const ORG_UUID = 'loadtest-org';

    public const TENANT_NAME = 'LoadTest Fleet';

    public function handle(TenantContext $context): int
    {
        if ($this->getLaravel()->isProduction() && ! $this->option('force')) {
            $this->error('Refusing to seed load-test data in production. Pass --force only on a throwaway/staging DB.');

            return self::FAILURE;
        }

        $count = max(1, (int) $this->option('drivers'));

        // Clean any prior run so the seed is idempotent.
        $this->call('loadtest:teardown', ['--force' => true]);

        $tenant = Tenant::create(['name' => self::TENANT_NAME, 'country' => 'DE']);
        $context->set($tenant->id);

        $session = UberFleetSession::create([
            'tenant_id' => $tenant->id,
            'uber_org_uuid' => self::ORG_UUID,
            'cookies' => ['loadtest' => true],
            'status' => UberFleetSession::STATUS_ACTIVE,
        ]);

        for ($i = 1; $i <= $count; $i++) {
            $driver = Driver::create([
                'tenant_id' => $tenant->id,
                'name' => "LoadTest Driver {$i}",
                'uber_driver_uuid' => "loadtest-drv-{$i}",
            ]);

            DeviceToken::create([
                'tenant_id' => $tenant->id,
                'driver_id' => $driver->id,
                'token' => "loadtest-token-{$i}",
                'platform' => 'android',
            ]);
        }

        $this->info('Seeded load-test fixture:');
        $this->table(['key', 'value'], [
            ['tenant_id', $tenant->id],
            ['session_id', $session->id],
            ['partner_uuid (PARTNER_UUID)', self::ORG_UUID],
            ['drivers', $count],
        ]);
        $this->line('');
        $this->line('Run the pipeline load test (from load-test/):');
        $this->line("  k6 run -e SESSION_ID={$session->id} -e DRIVERS={$count} \\");
        $this->line('    -e SECRET=$DISPATCH_INGEST_SECRET -e BASE_URL=http://localhost pipeline.js');

        return self::SUCCESS;
    }
}
