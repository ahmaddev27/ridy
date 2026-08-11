<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\DriverStatsService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DriverStatsTest extends TestCase
{
    use RefreshDatabase;

    private const UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private function offer(int $tenantId, array $o): void
    {
        DispatchOffer::create(array_merge([
            'tenant_id' => $tenantId,
            'driver_uuid' => self::UUID,
            'offer_uuid' => 'o-'.uniqid(),
            'received_at' => CarbonImmutable::now()->subHour(),
            'raw_payload' => [],
        ], $o));
    }

    public function test_stats_sum_earnings_and_km_from_accepted_offers(): void
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'Basel', 'uber_driver_uuid' => self::UUID]);

        // Accepted: German + English fare formats; distances in metres.
        $this->offer($tenant->id, ['fare_formatted' => '10,77 €', 'distance_m' => 5000, 'accepted_at' => now()]);
        $this->offer($tenant->id, ['fare_formatted' => '€12.93', 'distance_m' => 3000, 'accepted_at' => now()]);
        // Not accepted:
        $this->offer($tenant->id, ['fare_formatted' => '99,99 €', 'distance_m' => 9000, 'accepted_at' => null]);

        $stats = app(DriverStatsService::class)->forDriver(
            $driver,
            CarbonImmutable::now()->subDay(),
            CarbonImmutable::now()->addDay(),
        );

        $this->assertSame(3, $stats['offers']);
        $this->assertSame(2, $stats['accepted']);
        $this->assertSame(67, $stats['acceptance_rate']);       // 2/3
        $this->assertSame(23.7, $stats['earnings']);            // 10.77 + 12.93
        $this->assertSame(8.0, $stats['km']);                  // (5000+3000)/1000
        $this->assertSame(2, $stats['trips']);
    }
}
