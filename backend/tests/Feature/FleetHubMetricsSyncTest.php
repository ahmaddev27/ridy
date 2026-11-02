<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\FleetHub\EarnerMetricsSync;
use App\Domain\Fleet\FleetHub\EarningsSync;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Fleet\Models\FleetMetric;
use App\Domain\Tenancy\Models\Tenant;
use App\Jobs\SyncTenantEarnings;
use App\Jobs\SyncTenantMetrics;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/** Driver metrics (GetEarnerMetrics) + the fleet roll-up, behind UBER_SERVER_SYNC. */
class FleetHubMetricsSyncTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.uber.server_sync' => true, 'services.uber.metrics_delay_ms' => 0]);
    }

    private function tenant(): Tenant
    {
        $tenant = Tenant::create([
            'name' => 'Fleet', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
            'settings' => ['server_sync' => ['enabled' => true]],
        ]);
        $tenant->forceFill(['proxy_url' => 'http://user:pw@proxy.test:8080'])->save();
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-1',
            'cookies' => [['name' => 'sid', 'value' => 'ramen']],
            'supplier_cookies' => [['name' => 'sid', 'value' => 'hub']],
            'status' => UberFleetSession::STATUS_ACTIVE,
        ]);

        return $tenant;
    }

    private function driver(Tenant $tenant, string $uuid): Driver
    {
        return Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'D '.$uuid, 'email' => $uuid.'@x.de', 'phone' => '+49170',
            'employment_type' => 'employee', 'pseudonym_id' => 's-'.$uuid, 'latitude' => 52.5, 'longitude' => 13.4,
            'uber_rating' => 4.9, 'uber_picture_url' => 'https://img/x.png', 'uber_driver_uuid' => $uuid,
        ]);
    }

    private function metricsResponse(float $earnings): array
    {
        return ['status' => 'success', 'data' => ['metrics' => [
            ['metricName' => 'SUPPLY_METRIC_TOTAL_EARNINGS', 'metricValue' => ['doubleValue' => ['value' => $earnings]]],
            ['metricName' => 'SUPPLY_METRIC_TOTAL_EARNINGS_LABEL', 'metricValue' => ['stringValue' => ['value' => 'EUR']]],
            ['metricName' => 'SUPPLY_METRIC_TRIP_COUNT', 'metricValue' => ['int64Value' => ['value' => 12]]],
            ['metricName' => 'SUPPLY_METRIC_HOURS_ONLINE', 'metricValue' => ['doubleValue' => ['value' => 30.5]]],
            ['metricName' => 'SUPPLY_METRIC_ACCEPTANCE_RATE', 'metricValue' => ['doubleValue' => ['value' => 0.91]]],
        ]]];
    }

    private function earner(string $uuid, string $earn, string $net, string $cash): array
    {
        return [
            'earnerUuid' => $uuid, 'tripInfos' => [],
            'netOutstanding' => ['amountE5' => $net, 'currencyCode' => 'EUR'],
            'earnings' => ['amount' => ['amountE5' => $earn, 'currencyCode' => 'EUR'], 'children' => [
                ['categoryName' => 'fare', 'amount' => ['amountE5' => $earn]],
            ]],
            'payouts' => ['children' => [['categoryName' => 'cash_collected', 'amount' => ['amountE5' => $cash]]]],
        ];
    }

    public function test_metrics_job_upserts_driver_metrics_per_driver(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-11-04 12:00', 'Europe/Berlin'));
        $tenant = $this->tenant();
        $a = $this->driver($tenant, 'u-a');
        $this->driver($tenant, 'u-b');
        Http::fake(['*/api/GetEarnerMetrics*' => Http::response($this->metricsResponse(500.25))]);

        (new SyncTenantMetrics($tenant->id))->handle(app(EarnerMetricsSync::class));
        (new SyncTenantMetrics($tenant->id))->handle(app(EarnerMetricsSync::class));

        $this->assertSame(2, DriverMetric::withoutGlobalScopes()->count(), 're-run updates in place');
        $m = DriverMetric::withoutGlobalScopes()->where('driver_id', $a->id)->firstOrFail();
        $this->assertSame(500.25, (float) $m->earnings);
        $this->assertSame(12, (int) $m->trips);
        $this->assertSame(30.5, (float) $m->hours_online);
        $this->assertSame(0.91, (float) $m->acceptance_rate);
        Http::assertSent(fn (Request $r) => str_contains($r->url(), '/api/GetEarnerMetrics?localeCode=de-DE')
            && $r['orgUuid']['value'] === 'org-1'
            && $r['timeRange']['startsAt']['value'] === (string) CarbonImmutable::parse('2026-11-02 04:00', 'Europe/Berlin')->getTimestampMs()
            && in_array('SUPPLY_METRIC_CANCELLATION_RATE', $r['metrics'], true)
            && str_contains($r->header('cookie')[0], 'sid=hub'));
    }

    public function test_a_failing_driver_does_not_stop_the_others(): void
    {
        $tenant = $this->tenant();
        $this->driver($tenant, 'u-a');
        $this->driver($tenant, 'u-b');
        Http::fake(['*/api/GetEarnerMetrics*' => Http::sequence()
            ->push('', 500)->push($this->metricsResponse(10.0))]);

        $this->assertSame(1, app(EarnerMetricsSync::class)->syncTenant($tenant));
    }

    public function test_a_403_stops_the_run_after_one_call(): void
    {
        $tenant = $this->tenant();
        $this->driver($tenant, 'u-a');
        $this->driver($tenant, 'u-b');
        Http::fake(['*/api/GetEarnerMetrics*' => Http::response('', 403)]);

        (new SyncTenantMetrics($tenant->id))->handle(app(EarnerMetricsSync::class));

        Http::assertSentCount(1);
        $this->assertSame(0, DriverMetric::withoutGlobalScopes()->count());
    }

    public function test_flag_off_makes_no_calls_and_queues_nothing(): void
    {
        config(['services.uber.server_sync' => false]);
        Queue::fake();
        $tenant = $this->tenant();
        $this->driver($tenant, 'u-a');
        Http::fake();

        $this->artisan('fleet:sync-metrics')->assertSuccessful();
        Queue::assertNothingPushed();
        (new SyncTenantMetrics($tenant->id))->handle(app(EarnerMetricsSync::class));
        Http::assertNothingSent();
    }

    public function test_command_queues_one_job_per_eligible_tenant(): void
    {
        Queue::fake();
        $this->tenant();

        $this->artisan('fleet:sync-metrics')->assertSuccessful();

        Queue::assertPushed(SyncTenantMetrics::class, 1);
    }

    public function test_earnings_job_writes_the_fleet_rollup_from_the_earners(): void
    {
        $tenant = $this->tenant();
        Http::fake(['*/graphql' => Http::response(['data' => ['getEarnerBreakdownsV2' => [
            'earnerEarningsBreakdowns' => [
                $this->earner('u-1', '10000000', '4000000', '-2000000'),
                $this->earner('u-2', '5050000', '1000000', '-500000'),
            ],
            'pageInfo' => ['nextPageToken' => null],
        ]]])]);

        (new SyncTenantEarnings($tenant->id))->handle(app(EarningsSync::class));

        $f = FleetMetric::where('tenant_id', $tenant->id)->firstOrFail();
        $this->assertSame(150.5, (float) $f->earnings);
        $this->assertSame(50.0, (float) $f->net_outstanding);
        $this->assertSame(25.0, (float) $f->cash_collected);
        $this->assertSame(150.5, (float) $f->fare);
        $this->assertSame('EUR', $f->currency);
        $this->assertSame(150.5, (float) $f->breakdown['fare']);
        $this->assertNotNull($f->synced_at);
    }

    public function test_an_empty_earner_list_keeps_the_existing_rollup(): void
    {
        $tenant = $this->tenant();
        FleetMetric::create(['tenant_id' => $tenant->id, 'earnings' => 99, 'currency' => 'EUR']);
        Http::fake(['*/graphql' => Http::response(['data' => ['getEarnerBreakdownsV2' => [
            'earnerEarningsBreakdowns' => [], 'pageInfo' => ['nextPageToken' => null],
        ]]])]);

        app(EarningsSync::class)->syncTenant($tenant);

        $this->assertSame(99.0, (float) FleetMetric::where('tenant_id', $tenant->id)->first()->earnings);
    }
}
