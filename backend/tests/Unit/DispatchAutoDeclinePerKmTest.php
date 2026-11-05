<?php

namespace Tests\Unit;

use App\Domain\Dispatch\DispatchAutoDecline;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** The combined fare + €/km Early-decline criterion (docs/25), no DB involved. */
class DispatchAutoDeclinePerKmTest extends TestCase
{
    /** @return array<string, array{0: array<string, mixed>, 1: float|null, 2: int|null, 3: string|null}> */
    public static function cases(): array
    {
        $fare = ['enabled' => true, 'value_e2' => 1000]; // min 10 EUR
        $km = fn (string $mode) => ['enabled' => true, 'value_e2' => 150, 'mode' => $mode]; // min 1.50 EUR/km

        return [
            'nothing configured never declines' => [[], 3.0, 10000, null],
            'fare only, below' => [['min_fare' => $fare], 8.0, 2000, 'min_fare'],
            'fare only, ok' => [['min_fare' => $fare], 12.0, 20000, null],
            'per-km only, below (or mode moot)' => [['min_price_per_km' => $km('or')], 12.0, 10000, 'min_price_per_km'],
            'per-km only, ok' => [['min_price_per_km' => $km('and')], 12.0, 5000, null],
            'per-km only, km unknown passes' => [['min_price_per_km' => $km('and')], 12.0, null, null],
            'and: fare ok, per-km bad -> decline' => [['min_fare' => $fare, 'min_price_per_km' => $km('and')], 12.0, 10000, 'min_price_per_km'],
            'and: fare bad, per-km ok -> decline' => [['min_fare' => $fare, 'min_price_per_km' => $km('and')], 8.0, 2000, 'min_fare'],
            'and: both ok' => [['min_fare' => $fare, 'min_price_per_km' => $km('and')], 12.0, 5000, null],
            'or: fare ok, per-km bad -> keep' => [['min_fare' => $fare, 'min_price_per_km' => $km('or')], 12.0, 10000, null],
            'or: fare bad, per-km ok -> keep' => [['min_fare' => $fare, 'min_price_per_km' => $km('or')], 8.0, 2000, null],
            'or: both bad -> decline' => [['min_fare' => $fare, 'min_price_per_km' => $km('or')], 8.0, 10000, 'min_fare'],
            'disabled per-km ignored' => [['min_price_per_km' => ['enabled' => false, 'value_e2' => 150]], 1.0, 10000, null],
        ];
    }

    /**
     * @param  array<string, mixed>  $rules
     */
    #[DataProvider('cases')]
    public function test_decline_condition(array $rules, ?float $fare, ?int $distanceM, ?string $expected): void
    {
        $tenant = new Tenant;
        $tenant->settings = ['dispatch_reject' => ['enabled' => true]];
        $offer = new DispatchOffer(['fare_amount' => $fare, 'distance_m' => $distanceM]);
        $offer->setRelation('tenant', $tenant);
        $driver = new Driver;
        $driver->auto_decline = ['admin_enabled' => true, 'enabled' => true, 'rules' => $rules];

        $this->assertSame($expected, (new DispatchAutoDecline)->match($offer, $driver));
    }
}
