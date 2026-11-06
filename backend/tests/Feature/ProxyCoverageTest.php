<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Ops\Models\AlertIncident;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProxyCoverageTest extends TestCase
{
    use RefreshDatabase;

    private function tenant(string $name = 'Acme'): Tenant
    {
        return Tenant::create(['name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
    }

    public function test_resync_copies_proxy_url_verbatim_to_assigned_tenants(): void
    {
        $proxy = Proxy::create(['label' => 'P', 'url' => 'http://u:p_country-de@h:1', 'capacity' => 5]);
        $tenant = $this->tenant();
        $tenant->forceFill(['proxy_id' => $proxy->id, 'proxy_url' => 'http://stale@h:1'])->save();

        $this->artisan('proxies:resync-urls')->assertSuccessful();

        $this->assertSame('http://u:p_country-de@h:1', $tenant->refresh()->proxy_url);
    }

    public function test_assign_missing_is_scheduled(): void
    {
        $commands = collect(app(Schedule::class)->events())->pluck('command')->implode("\n");
        $this->assertStringContainsString('proxies:assign-missing', $commands);
    }

    public function test_alerts_fire_for_active_session_without_proxy_and_full_pool(): void
    {
        $tenant = $this->tenant('NoProxy');
        UberFleetSession::withoutGlobalScopes()->create(['tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-1', 'cookies' => [], 'status' => UberFleetSession::STATUS_ACTIVE]);

        $this->artisan('alerts:check')->assertSuccessful();

        $this->assertNotNull(AlertIncident::where('key', "proxy_missing:{$tenant->id}")->whereNull('resolved_at')->first());
        $this->assertNotNull(AlertIncident::where('key', 'proxy_pool_full')->whereNull('resolved_at')->first());

        Proxy::create(['label' => 'P', 'url' => 'http://u:p@h:1', 'capacity' => 5]);
        app(ProxyPool::class)->assign($tenant);
        $this->artisan('alerts:check')->assertSuccessful();
        $this->assertNull(AlertIncident::where('key', 'proxy_pool_full')->whereNull('resolved_at')->first());
        $this->assertNull(AlertIncident::where('key', "proxy_missing:{$tenant->id}")->whereNull('resolved_at')->first());
    }
}
