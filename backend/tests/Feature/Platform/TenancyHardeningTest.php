<?php

namespace Tests\Feature\Platform;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use App\Domain\Tenancy\SystemHealthService;
use App\Models\User;
use App\Support\PlatformCounters;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TenancyHardeningTest extends TestCase
{
    use RefreshDatabase;

    private function usableTenant(string $name): Tenant
    {
        return Tenant::create(['name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
    }

    private function actAsSuperAdmin(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
    }

    public function test_tenant_at_capacity_keeps_its_proxy_on_reassign(): void
    {
        $p1 = Proxy::create(['label' => 'P1', 'url' => 'http://u:p@one:1', 'capacity' => 2]);
        $tenant = $this->usableTenant('Acme');
        app(ProxyPool::class)->assign($tenant);
        $this->assertSame($p1->id, $tenant->fresh()->proxy_id);
        Proxy::create(['label' => 'P2', 'url' => 'http://u:p@two:1', 'capacity' => 50]);

        // Its own drivers exactly fill the proxy — a renewal must not bounce it.
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'D1']);
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'D2']);
        app(ProxyPool::class)->assign($tenant->fresh());

        $this->assertSame($p1->id, $tenant->fresh()->proxy_id);
    }

    public function test_tenant_proxy_url_is_encrypted_at_rest_and_follows_rotation(): void
    {
        $this->actAsSuperAdmin();
        $proxy = Proxy::create(['label' => 'P1', 'url' => 'http://u:old@host:1', 'capacity' => 5]);
        $tenant = $this->usableTenant('Acme');
        app(ProxyPool::class)->assign($tenant);

        $raw = DB::table('tenants')->where('id', $tenant->id)->value('proxy_url');
        $this->assertStringNotContainsString('old@host', (string) $raw);
        $this->assertSame('http://u:old@host:1', $tenant->fresh()->proxy_url);

        $this->putJson("/api/v1/admin/proxies/{$proxy->id}", ['label' => 'P1', 'url' => 'http://u:new@host:1', 'capacity' => 5])->assertOk();

        $this->assertSame('http://u:new@host:1', $tenant->fresh()->proxy_url);
    }

    public function test_deleting_a_proxy_moves_its_companies_off_the_deleted_credentials(): void
    {
        $this->actAsSuperAdmin();
        $dying = Proxy::create(['label' => 'Old', 'url' => 'http://u:p@old:1', 'capacity' => 5]);
        $tenant = $this->usableTenant('Acme');
        app(ProxyPool::class)->assign($tenant);
        $spare = Proxy::create(['label' => 'New', 'url' => 'http://u:p@new:1', 'capacity' => 5]);

        $this->deleteJson("/api/v1/admin/proxies/{$dying->id}")->assertOk();

        $tenant->refresh();
        $this->assertSame($spare->id, $tenant->proxy_id);
        $this->assertSame('http://u:p@new:1', $tenant->proxy_url);
    }

    public function test_legacy_plaintext_proxy_url_still_reads(): void
    {
        $tenant = $this->usableTenant('Legacy');
        DB::table('tenants')->where('id', $tenant->id)->update(['proxy_url' => 'http://u:p@plain:1']);

        $this->assertSame('http://u:p@plain:1', $tenant->fresh()->proxy_url);
    }

    public function test_system_health_judges_every_row_against_the_same_clock(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-24 12:00:00'));
        $tenants = [];
        for ($i = 0; $i < 4; $i++) {
            $tenants[$i] = $this->usableTenant("T{$i}");
            UberFleetSession::create([
                'tenant_id' => $tenants[$i]->id, 'uber_org_uuid' => "org-{$i}", 'cookies' => [],
                'status' => UberFleetSession::STATUS_ACTIVE, 'expires_at' => now()->addDay(),
                // The last one went silent 20 minutes ago; the rest are live.
                'last_event_at' => $i === 3 ? now()->subMinutes(20) : now()->subMinutes(4),
            ]);
        }

        $rows = collect(app(SystemHealthService::class)->report())->keyBy('id');

        $this->assertFalse($rows[$tenants[3]->id]['session']['ok']);
        $this->assertFalse($rows[$tenants[3]->id]['daemon']['ok']);
        foreach ([0, 1, 2] as $i) {
            $this->assertTrue($rows[$tenants[$i]->id]['session']['ok']);
        }
    }

    public function test_admin_offer_chart_buckets_by_fleet_day(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-24 12:00:00'));
        $tenant = $this->usableTenant('Acme');
        // 02:30 on the 24th belongs to the fleet-day of the 23rd.
        DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'u', 'offer_uuid' => 'o1',
            'received_at' => CarbonImmutable::parse('2026-09-24 02:30:00'), 'raw_payload' => [], 'status' => OfferStatus::Pending,
        ]);

        $counts = app(PlatformCounters::class)->offersDaily(CarbonImmutable::parse('2026-09-11 04:00:00'));

        $this->assertSame(1, $counts['2026-09-23'] ?? null);
        $this->assertArrayNotHasKey('2026-09-24', $counts);
    }
}
