<?php

namespace Tests\Feature\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Support\PlatformCounters;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class PlatformCountersCacheTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush(); // isolate each test from a warm counter cache
    }

    public function test_counts_are_grouped_and_totalled_per_tenant(): void
    {
        [$acme, $globex] = $this->seedTwoTenants();

        $counters = app(PlatformCounters::class);

        $this->assertSame(5, $counters->totalOffers());
        $this->assertSame(3, (int) $counters->offersByTenant()[$acme->id]);
        $this->assertSame(2, (int) $counters->offersByTenant()[$globex->id]);
        $this->assertSame(2, (int) $counters->driversByTenant()[$acme->id]);
        $this->assertSame(1, (int) $counters->driversByTenant()[$globex->id]);
    }

    public function test_total_stays_cached_within_the_ttl_then_refreshes_after_flush(): void
    {
        [$acme] = $this->seedTwoTenants();

        $counters = app(PlatformCounters::class);
        $this->assertSame(5, $counters->totalOffers()); // warms the cache

        $this->makeOffer($acme, 'extra');
        $this->assertSame(5, $counters->totalOffers()); // still the cached value

        Cache::flush();
        $this->assertSame(6, $counters->totalOffers()); // now reflects the new row
    }

    /** @return array{0: Tenant, 1: Tenant} */
    private function seedTwoTenants(): array
    {
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $globex = Tenant::create(['name' => 'Globex', 'country' => 'DE']);

        Driver::create(['tenant_id' => $acme->id, 'name' => 'A1', 'uber_driver_uuid' => 'a1']);
        Driver::create(['tenant_id' => $acme->id, 'name' => 'A2', 'uber_driver_uuid' => 'a2']);
        Driver::create(['tenant_id' => $globex->id, 'name' => 'G1', 'uber_driver_uuid' => 'g1']);

        foreach (['a-1', 'a-2', 'a-3'] as $uuid) {
            $this->makeOffer($acme, $uuid);
        }
        foreach (['g-1', 'g-2'] as $uuid) {
            $this->makeOffer($globex, $uuid);
        }

        return [$acme, $globex];
    }

    private function makeOffer(Tenant $tenant, string $suffix): void
    {
        DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => $suffix,
            'offer_uuid' => "of-{$tenant->id}-{$suffix}",
            'received_at' => now(),
            'raw_payload' => [],
        ]);
    }
}
