<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A lapsed company's drivers must read as offline everywhere — the daemon and the
 * extension both stop feeding their status once the subscription ends, so the
 * last-known "online" would otherwise stay frozen in the admin list/stats/map.
 */
class OfflineLapsedDriversTest extends TestCase
{
    use RefreshDatabase;

    private function driverFor(Tenant $tenant, string $status = 'ONLINE'): Driver
    {
        app(TenantContext::class)->set($tenant->id);

        return Driver::create([
            'tenant_id' => $tenant->id,
            'name' => 'D'.$tenant->id,
            'online_status' => $status,
            'latitude' => 51.25,
            'longitude' => 7.15,
            'heading' => 90,
        ]);
    }

    public function test_lapsed_company_drivers_are_set_offline_active_ones_untouched(): void
    {
        $active = Tenant::create([
            'name' => 'Active', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        $expired = Tenant::create([
            'name' => 'Expired', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now()->subYear(), 'subscription_ends_at' => now()->subDay(),
        ]);

        $activeDriver = $this->driverFor($active);
        $expiredDriver = $this->driverFor($expired);

        $this->artisan('fleet:offline-lapsed')->assertSuccessful();

        // The lapsed company's driver reads offline, its stale location cleared.
        $expiredDriver->refresh();
        $this->assertNull($expiredDriver->online_status);
        $this->assertNull($expiredDriver->latitude);
        $this->assertFalse(Driver::statusIsOnline($expiredDriver->online_status));

        // The active company's driver is untouched.
        $activeDriver->refresh();
        $this->assertSame('ONLINE', $activeDriver->online_status);
        $this->assertSame(51.25, (float) $activeDriver->latitude);
    }

    public function test_it_is_idempotent_and_skips_already_offline_drivers(): void
    {
        $expired = Tenant::create([
            'name' => 'Expired', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now()->subYear(), 'subscription_ends_at' => now()->subDay(),
        ]);
        $offline = $this->driverFor($expired, 'OFFLINE');

        // Already offline → the online() scope doesn't match it, so it's left as-is.
        $this->artisan('fleet:offline-lapsed')->assertSuccessful();

        $this->assertSame('OFFLINE', $offline->fresh()->online_status);
    }
}
