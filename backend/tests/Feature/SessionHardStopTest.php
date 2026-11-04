<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Events\DriversBroadcast;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SessionHardStopTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const PAYLOAD = ['statuses' => [['driver_uuid' => 'd1', 'status' => 'MONITORING_SUPPLY_STATUS_ONLINE']]];

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
        $this->seed(RolePermissionSeeder::class);
    }

    private function tenantWithSession(string $name, string $status): array
    {
        $tenant = Tenant::create(['name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        $session = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-'.$tenant->id,
            'cookies' => [['name' => 'sid', 'value' => 'v']], 'status' => $status,
        ]);

        return [$tenant, $session];
    }

    private function actAsManager(Tenant $tenant): void
    {
        $user = User::create(['name' => 'M', 'email' => "m{$tenant->id}@x.de", 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        Sanctum::actingAs($user);
    }

    public function test_daemon_statuses_for_a_stopped_session_is_a_no_op(): void
    {
        [$tenant, $session] = $this->tenantWithSession('Stopped', UberFleetSession::STATUS_NEEDS_RELINK);

        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/statuses", self::PAYLOAD)
            ->assertOk()->assertJsonPath('data.skipped', 'session_not_active');

        $this->assertFalse(DriverStatusIngestor::daemonIsFeeding($tenant->id));
    }

    public function test_extension_statuses_are_ignored_once_the_company_is_stopped(): void
    {
        Event::fake([DriversBroadcast::class]);
        [$tenant] = $this->tenantWithSession('Stopped', UberFleetSession::STATUS_NEEDS_RELINK);
        $tenant->blockAutolink();
        $this->actAsManager($tenant);

        $this->postJson('/api/v1/drivers/statuses', self::PAYLOAD)
            ->assertOk()->assertJsonPath('data.skipped', 'session_stopped');

        Event::assertNotDispatched(DriversBroadcast::class);
    }

    public function test_extension_only_company_with_an_active_session_still_ingests_and_broadcasts(): void
    {
        Event::fake([DriversBroadcast::class]);
        [$tenant] = $this->tenantWithSession('Live', UberFleetSession::STATUS_ACTIVE);
        $this->actAsManager($tenant);

        $this->postJson('/api/v1/drivers/statuses', self::PAYLOAD)
            ->assertOk()->assertJsonMissingPath('data.skipped');

        Event::assertDispatched(DriversBroadcast::class);
    }

    public function test_admin_stop_marks_every_session_of_the_company(): void
    {
        [$tenant, $first] = $this->tenantWithSession('Multi', UberFleetSession::STATUS_ACTIVE);
        $second = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-b',
            'cookies' => [['name' => 'sid', 'value' => 'v']], 'status' => UberFleetSession::STATUS_ACTIVE,
        ]);
        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);

        $this->postJson("/api/v1/admin/companies/{$tenant->id}/session/relink")->assertOk();

        $this->assertSame(0, UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)->where('status', UberFleetSession::STATUS_ACTIVE)->count());
        $this->assertNull($second->fresh()->shard_id);
    }

    public function test_assign_missing_dry_run_reports_without_writing_then_the_real_run_assigns(): void
    {
        $proxy = Proxy::create(['label' => 'P', 'url' => 'http://u:p@host:1', 'capacity' => 5]);
        [$tenant] = $this->tenantWithSession('Bare', UberFleetSession::STATUS_ACTIVE);
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'D1']);

        $this->artisan('proxies:assign-missing --dry-run')
            ->expectsOutputToContain('Would assign 1 of 1')->assertSuccessful();
        $this->assertNull($tenant->fresh()->proxy_id);

        $this->artisan('proxies:assign-missing')->expectsOutputToContain('Assigned 1 of 1')->assertSuccessful();
        $this->assertSame($proxy->id, $tenant->fresh()->proxy_id);
    }
}
