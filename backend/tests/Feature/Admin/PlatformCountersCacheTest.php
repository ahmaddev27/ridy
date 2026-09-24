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

    /**
     * Prod regression: the DB cache store serializes values and
     * config('cache.serializable_classes') is false, so a cached Collection was
     * read back as __PHP_Incomplete_Class (TypeError on /admin/overview and
     * /admin/companies). The array store used elsewhere in tests never
     * serializes, which is why it slipped through — this runs a real round trip.
     */
    public function test_counts_survive_a_real_serializing_cache_round_trip(): void
    {
        config(['cache.default' => 'database', 'cache.serializable_classes' => false]);
        Cache::flush();
        [$acme] = $this->seedTwoTenants();

        app(PlatformCounters::class)->offersByTenant();   // write
        app(PlatformCounters::class)->driversByTenant();

        $counters = app(PlatformCounters::class);          // read back from the DB store
        $this->assertSame(3, (int) $counters->offersByTenant()[$acme->id]);
        $this->assertSame(2, (int) $counters->driversByTenant()[$acme->id]);
        $this->assertSame(5, $counters->totalOffers());
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
