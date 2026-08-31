<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\FleetMetric;
use App\Domain\Fleet\SupplierBreakdownParser;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SupplierBreakdownParserTest extends TestCase
{
    use RefreshDatabase;

    public function test_stores_the_fleet_cash_and_net_rollup(): void
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);

        // Shape as captured by the extension: {operationName, data: {data: {getSupplierBreakdownV2}}}.
        $payload = [
            'operationName' => 'getSupplierBreakdownV2',
            'data' => ['data' => ['getSupplierBreakdownV2' => [
                'endBalance' => ['amountE5' => '13553000', 'currencyCode' => 'EUR'],
                'earnings' => [
                    'amount' => ['amountE5' => '27463000', 'currencyCode' => 'EUR'],
                    'children' => [
                        ['categoryName' => 'fare', 'amount' => ['amountE5' => '27463000']],
                    ],
                ],
                'payouts' => [
                    'children' => [
                        ['categoryName' => 'cash_collected', 'amount' => ['amountE5' => '-13910000']],
                    ],
                ],
            ]]],
        ];

        $this->assertTrue(SupplierBreakdownParser::handles($payload));
        app(SupplierBreakdownParser::class)->store($tenant->id, $payload);

        $m = FleetMetric::where('tenant_id', $tenant->id)->firstOrFail();
        $this->assertSame('274.63', (string) $m->earnings);
        $this->assertSame('135.53', (string) $m->net_outstanding);
        $this->assertSame('139.10', (string) $m->cash_collected); // magnitude of the negative payout
        $this->assertSame('274.63', (string) $m->fare);
        $this->assertSame('EUR', $m->currency);

        // Re-capturing upserts the same single row (latest snapshot per tenant).
        app(SupplierBreakdownParser::class)->store($tenant->id, $payload);
        $this->assertSame(1, FleetMetric::where('tenant_id', $tenant->id)->count());
    }
}
