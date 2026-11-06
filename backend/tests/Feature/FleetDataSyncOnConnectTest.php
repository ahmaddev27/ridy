<?php

namespace Tests\Feature;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Jobs\SyncTenantEarnings;
use App\Jobs\SyncTenantMetrics;
use App\Jobs\SyncTenantVehicles;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Fleet Hub data is pulled the moment a supplier jar arrives, not at the next hourly tick. */
class FleetDataSyncOnConnectTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '11111111-1111-4111-8111-111111111111';

    private const JAR = [['name' => 'sid', 'value' => 'hub']];

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.uber.server_sync' => true]);
        Queue::fake();
    }

    private function tenant(bool $proxy = true, bool $migrated = true): Tenant
    {
        $tenant = Tenant::create([
            'name' => 'Fleet', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        $tenant->setCobrowseEnabled($migrated);
        if ($proxy) {
            $tenant->forceFill(['proxy_url' => 'http://user:pw@proxy.test:8080'])->save();
        }

        return $tenant;
    }

    private function capture(Tenant $tenant, ?array $supplier): void
    {
        app(FleetSessionService::class)->capture($tenant, self::ORG, [['name' => 'sid', 'value' => 'ramen']], supplierCookies: $supplier);
    }

    public function test_capture_with_supplier_jar_dispatches_all_three_syncs(): void
    {
        $this->capture($this->tenant(), self::JAR);

        Queue::assertPushed(SyncTenantVehicles::class, 1);
        Queue::assertPushed(SyncTenantEarnings::class, 1);
        Queue::assertPushed(SyncTenantMetrics::class, 1);
    }

    public function test_capture_without_supplier_jar_dispatches_nothing(): void
    {
        $this->capture($this->tenant(), null);

        Queue::assertNothingPushed();
    }

    public function test_routine_recapture_does_not_redispatch(): void
    {
        $tenant = $this->tenant();
        $this->capture($tenant, self::JAR);
        $this->capture($tenant, self::JAR);

        Queue::assertPushed(SyncTenantVehicles::class, 1);
    }

    public function test_ineligible_tenant_is_skipped_and_the_reason_logged(): void
    {
        Log::spy();

        $this->capture($this->tenant(proxy: false), self::JAR);

        Queue::assertNothingPushed();
        Log::shouldHaveReceived('info')->with('fleethub.sync_skipped', ['tenant' => 1, 'reason' => 'no_proxy'])->atLeast()->once();
    }

    private function manager(Tenant $tenant): User
    {
        $this->seed(RolePermissionSeeder::class);
        $user = User::create(['name' => 'M', 'email' => 'm@x.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        return $user;
    }

    public function test_sync_now_endpoint_reports_the_skip_reason(): void
    {
        $tenant = $this->tenant(proxy: false);
        $this->capture($tenant, self::JAR);
        Sanctum::actingAs($this->manager($tenant));

        $this->postJson('/api/v1/vehicles/sync-now')
            ->assertOk()
            ->assertJsonPath('data', ['status' => 'skipped', 'reason' => 'no_proxy']);
    }

    public function test_sync_now_endpoint_pulls_vehicles_and_earnings(): void
    {
        $tenant = $this->tenant();
        $this->capture($tenant, self::JAR);
        Sanctum::actingAs($this->manager($tenant));
        Http::fake(['*/graphql' => Http::response(['data' => [
            'SearchSupplierVehicles' => ['vehicles' => [['uuid' => 'veh-1']]],
            'getEarnerBreakdownsV2' => ['earnerEarningsBreakdowns' => [], 'pageInfo' => ['nextPageToken' => null]],
        ]])]);

        $this->postJson('/api/v1/vehicles/sync-now')
            ->assertOk()
            ->assertJsonPath('data.status', 'synced')
            ->assertJsonPath('data.vehicles', 1);
    }

    public function test_server_sync_off_dispatches_nothing(): void
    {
        config(['services.uber.server_sync' => false]);

        $this->capture($this->tenant(), self::JAR);

        Queue::assertNothingPushed();
    }
}
