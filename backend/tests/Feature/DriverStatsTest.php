<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
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

    public function test_stats_sum_earnings_and_km_from_completed_offers(): void
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'Basel', 'uber_driver_uuid' => self::UUID]);

        // Completed trips — earnings + km come from these only.
        $this->offer($tenant->id, ['fare_amount' => 10.77, 'distance_m' => 5000, 'accepted_at' => now(), 'status' => OfferStatus::Completed]);
        $this->offer($tenant->id, ['fare_amount' => 12.93, 'distance_m' => 3000, 'accepted_at' => now(), 'status' => OfferStatus::Completed]);
        // Accepted but canceled (never completed): counts as taken, NOT as earnings.
        $this->offer($tenant->id, ['fare_amount' => 50, 'distance_m' => 9000, 'accepted_at' => now(), 'status' => OfferStatus::Canceled]);
        // Not accepted:
        $this->offer($tenant->id, ['fare_amount' => 99.99, 'distance_m' => 9000, 'accepted_at' => null, 'status' => OfferStatus::Rejected]);

        $stats = app(DriverStatsService::class)->forDriver(
            $driver,
            CarbonImmutable::now()->subDay(),
            CarbonImmutable::now()->addDay(),
        );

        $this->assertSame(4, $stats['offers']);
        $this->assertSame(3, $stats['accepted']);               // 2 completed + 1 canceled were taken
        $this->assertSame(75, $stats['acceptance_rate']);       // 3/4
        $this->assertSame(23.7, $stats['earnings']);            // completed only: 10.77 + 12.93
        $this->assertSame(8.0, $stats['km']);                   // completed only: (5000+3000)/1000
        $this->assertSame(2, $stats['trips']);                  // completed count
    }
}
