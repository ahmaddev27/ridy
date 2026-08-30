<?php

namespace Tests\Feature;

use App\Domain\Fleet\EarnerBreakdownParser;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EarnerBreakdownParserTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_upserts_per_driver_earnings_from_a_breakdown_capture(): void
    {
        $tenant = Tenant::create(['name' => 'Move Now', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);
        $uuid = '28e98804-0061-4a4d-87e7-4086d1c4a9b3';
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'Abd', 'uber_driver_uuid' => $uuid]);

        $payload = [
            'operationName' => 'getEarnerBreakdownsV2',
            'variables' => ['timeRange' => ['startTimeUnixMillis' => '1787536889000', 'endTimeUnixMillis' => '1788141689000']],
            'data' => ['getEarnerBreakdownsV2' => ['earnerEarningsBreakdowns' => [[
                'earnerUuid' => $uuid,
                'earnerMetadata' => ['name' => 'Abd Alhamid Hamou'],
                'tripInfos' => [
                    ['tripAttributeName' => 'TRIP_ATTRIBUTE_NAME_COUNT', 'value' => '91'],
                    ['tripAttributeName' => 'TRIP_ATTRIBUTE_NAME_DISTRANCE', 'value' => '993.21 km'],
                ],
                'netOutstanding' => ['amountE5' => '98421620', 'currencyCode' => 'EUR'],
                'earnings' => [
                    'amount' => ['amountE5' => '148103620', 'currencyCode' => 'EUR'],
                    'children' => [
                        ['categoryName' => 'fare', 'amount' => ['amountE5' => '122170620']],
                        ['categoryName' => 'promotion', 'amount' => ['amountE5' => '17000000']],
                        ['categoryName' => 'tip', 'amount' => ['amountE5' => '4000000']],
                    ],
                ],
                'payouts' => ['children' => [
                    ['categoryName' => 'cash_collected', 'amount' => ['amountE5' => '-49682000']],
                ]],
            ]]]],
        ];

        $this->assertTrue(EarnerBreakdownParser::handles($payload));
        $stored = app(EarnerBreakdownParser::class)->parse($tenant->id, $payload);

        $this->assertSame(1, $stored);
        $m = DriverMetric::withoutGlobalScopes()->where('driver_id', $driver->id)->firstOrFail();
        $this->assertEquals(1481.04, (float) $m->earnings);       // 148103620 / 1e5
        $this->assertEquals(984.22, (float) $m->net_outstanding); // 98421620 / 1e5
        $this->assertSame(91, $m->trips);
        $this->assertEquals(993.21, (float) $m->distance_km);
        $this->assertSame('EUR', $m->earnings_label);
        $this->assertEquals(1221.71, $m->breakdown['fare']);
        $this->assertEquals(170.0, $m->breakdown['promotion']);
        $this->assertEquals(-496.82, $m->breakdown['cash_collected']);
    }

    public function test_it_ignores_unrelated_captures(): void
    {
        $this->assertFalse(EarnerBreakdownParser::handles(['operationName' => 'somethingElse']));
        $this->assertFalse(EarnerBreakdownParser::handles(['data' => ['other' => 1]]));
    }
}
