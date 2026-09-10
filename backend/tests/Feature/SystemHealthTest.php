<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SystemHealthTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_reports_healthy_and_problem_flags_per_tenant(): void
    {
        $now = CarbonImmutable::now();

        $proxy = Proxy::create(['label' => 'Pool A', 'url' => 'http://u:p@host:1', 'capacity' => 10, 'expires_at' => $now->addDays(30)]);

        // Healthy tenant: active subscription, live session/daemon, valid proxy.
        $healthy = Tenant::create([
            'name' => 'Healthy Co',
            'country' => 'DE',
            'status' => 'active',
            'activated_at' => $now->subDay(),
            'subscription_ends_at' => $now->addDays(20),
            'proxy_id' => $proxy->id,
        ]);
        UberFleetSession::create([
            'tenant_id' => $healthy->id,
            'uber_org_uuid' => 'org-healthy',
            'cookies' => [['name' => 'sid', 'value' => 'x']],
            'status' => UberFleetSession::STATUS_ACTIVE,
            'expires_at' => $now->addDays(10),
            'last_event_at' => $now->subMinute(),
        ]);

        // Broken tenant: expired subscription, stale/expired session, expired proxy.
        $expiredProxy = Proxy::create(['label' => 'Old Pool', 'url' => 'http://u:p@host:2', 'capacity' => 10, 'expires_at' => $now->subDay()]);
        $broken = Tenant::create([
            'name' => 'Broken Co',
            'country' => 'DE',
            'status' => 'active',
            'activated_at' => $now->subDays(60),
            'subscription_ends_at' => $now->subDays(2),
            'proxy_id' => $expiredProxy->id,
        ]);
        UberFleetSession::create([
            'tenant_id' => $broken->id,
            'uber_org_uuid' => 'org-broken',
            'cookies' => [['name' => 'sid', 'value' => 'y']],
            'status' => UberFleetSession::STATUS_EXPIRED,
            'expires_at' => $now->subDay(),
            'last_event_at' => $now->subHour(),
        ]);

        Sanctum::actingAs($this->superAdmin());

        $res = $this->getJson('/api/v1/admin/system-health')->assertOk();

        // Most-problematic first: the broken tenant leads.
        $res->assertJsonPath('data.0.name', 'Broken Co')
            ->assertJsonPath('data.0.subscription.state', 'expired')
            ->assertJsonPath('data.0.session.ok', false)
            ->assertJsonPath('data.0.daemon.ok', false)
            ->assertJsonPath('data.0.proxy.ok', false)
            ->assertJsonPath('data.1.name', 'Healthy Co')
            ->assertJsonPath('data.1.subscription.state', null)
            ->assertJsonPath('data.1.session.ok', true)
            ->assertJsonPath('data.1.daemon.ok', true)
            ->assertJsonPath('data.1.proxy.ok', true);
    }

    public function test_a_renewed_proxy_whose_base_period_passed_reads_as_healthy(): void
    {
        $now = CarbonImmutable::now();

        // Base period expired, but a paid renewal extends it 28 days out — the REAL
        // expiry. System health must judge by that, not the stale base period.
        $proxy = Proxy::create(['label' => 'Renewed Pool', 'url' => 'http://u:p@host:9', 'capacity' => 10, 'expires_at' => $now->subDays(3)]);
        $proxy->renewals()->create(['amount' => 20, 'starts_at' => $now->subDays(3), 'ends_at' => $now->addDays(28)]);

        $tenant = Tenant::create([
            'name' => 'Renewed Co',
            'country' => 'DE',
            'status' => 'active',
            'activated_at' => $now->subDay(),
            'subscription_ends_at' => $now->addDays(20),
            'proxy_id' => $proxy->id,
        ]);
        UberFleetSession::create([
            'tenant_id' => $tenant->id,
            'uber_org_uuid' => 'org-renewed',
            'cookies' => [['name' => 'sid', 'value' => 'z']],
            'status' => UberFleetSession::STATUS_ACTIVE,
            'expires_at' => $now->addDays(10),
            'last_event_at' => $now->subMinute(),
        ]);

        Sanctum::actingAs($this->superAdmin());

        $this->getJson('/api/v1/admin/system-health')->assertOk()
            ->assertJsonPath('data.0.proxy.ok', true)
            ->assertJsonPath('data.0.proxy.expires_at', $now->addDays(28)->toDateString());
    }

    public function test_a_renewed_proxy_does_not_raise_the_overview_expiring_alert(): void
    {
        $now = CarbonImmutable::now();

        // Base period expired, renewal 28 days out → NOT expiring: absent from the alert.
        $renewed = Proxy::create(['label' => 'Renewed', 'url' => 'http://u:p@host:8', 'capacity' => 5, 'expires_at' => $now->subDays(2)]);
        $renewed->renewals()->create(['amount' => 20, 'starts_at' => $now->subDays(2), 'ends_at' => $now->addDays(28)]);

        // A genuinely-expiring proxy (3 days left, no renewal) still surfaces.
        Proxy::create(['label' => 'Expiring', 'url' => 'http://u:p@host:7', 'capacity' => 5, 'expires_at' => $now->addDays(3)]);

        Sanctum::actingAs($this->superAdmin());

        $labels = collect($this->getJson('/api/v1/admin/overview')->assertOk()->json('data.expiring_proxies'))
            ->pluck('label');

        $this->assertTrue($labels->contains('Expiring'));
        $this->assertFalse($labels->contains('Renewed'), 'a renewed proxy must not appear in the expiring alert');
    }

    public function test_manager_cannot_reach_system_health(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $m = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $m->assignRole('fleet_manager');

        Sanctum::actingAs($m);
        $this->getJson('/api/v1/admin/system-health')->assertForbidden();
    }
}
