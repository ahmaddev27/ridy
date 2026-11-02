<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\FleetHub\EarningsSync;
use App\Domain\Fleet\FleetHub\FleetHubSessionResolver;
use App\Domain\Fleet\FleetHub\VehicleSync;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Tenancy\Models\Tenant;
use App\Jobs\SyncTenantEarnings;
use App\Jobs\SyncTenantVehicles;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The server-side Fleet Hub pulls (earnings + vehicles) behind UBER_SERVER_SYNC. */
class FleetHubServerSyncTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.uber.server_sync' => true]);
    }

    private function tenant(string $name = 'Fleet', bool $session = true, bool $proxy = true, bool $enabled = true): Tenant
    {
        $tenant = Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
            'settings' => ['server_sync' => ['enabled' => $enabled]],
        ]);
        if ($proxy) {
            $tenant->forceFill(['proxy_url' => 'http://user:pw@proxy.test:8080'])->save();
        }
        if ($session) {
            UberFleetSession::withoutGlobalScopes()->create([
                'tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-'.$tenant->id,
                'cookies' => [['name' => 'sid', 'value' => 'ramen']],
                'supplier_cookies' => [['name' => 'sid', 'value' => 'hub']],
                'status' => UberFleetSession::STATUS_ACTIVE,
            ]);
        }

        return $tenant;
    }

    private function earner(string $uuid): array
    {
        return [
            'earnerUuid' => $uuid,
            'tripInfos' => [['tripAttributeName' => 'TRIP_ATTRIBUTE_NAME_COUNT', 'value' => '67']],
            'netOutstanding' => ['amountE5' => '46593000', 'currencyCode' => 'EUR'],
            'earnings' => ['categoryName' => 'earnings', 'amount' => ['amountE5' => '69219000', 'currencyCode' => 'EUR'], 'children' => [
                ['categoryName' => 'fare', 'amount' => ['amountE5' => '66419000']],
                ['categoryName' => 'tip', 'amount' => ['amountE5' => '2800000']],
            ]],
            'payouts' => ['categoryName' => 'payouts', 'amount' => ['amountE5' => '-22626000'], 'children' => [
                ['categoryName' => 'cash_collected', 'amount' => ['amountE5' => '-22626000']],
            ]],
        ];
    }

    private function earningsPage(array $earners): array
    {
        return ['data' => ['getEarnerBreakdownsV2' => [
            'earnerEarningsBreakdowns' => $earners, 'pageInfo' => ['nextPageToken' => null],
        ]]];
    }

    private function driver(Tenant $tenant, string $uuid): Driver
    {
        return Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'Ahmed', 'email' => 'a@x.de', 'phone' => '+49170',
            'employment_type' => 'employee', 'pseudonym_id' => 's-'.$uuid, 'latitude' => 52.5, 'longitude' => 13.4,
            'uber_rating' => 4.9, 'uber_picture_url' => 'https://img/x.png', 'uber_driver_uuid' => $uuid,
        ]);
    }

    public function test_earnings_job_upserts_driver_metrics_for_the_current_week(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-11-04 12:00', 'Europe/Berlin'));
        $tenant = $this->tenant();
        $driver = $this->driver($tenant, 'u-ahmed');
        Http::fake(['*/graphql' => Http::response($this->earningsPage([$this->earner('u-ahmed'), $this->earner('u-stranger')]))]);

        (new SyncTenantEarnings($tenant->id))->handle(app(EarningsSync::class));
        (new SyncTenantEarnings($tenant->id))->handle(app(EarningsSync::class));

        $metric = DriverMetric::withoutGlobalScopes()->where('driver_id', $driver->id)->get();
        $this->assertCount(1, $metric, 'a re-run updates the same row');
        $this->assertSame(692.19, (float) $metric[0]->earnings);
        $this->assertSame(67, (int) $metric[0]->trips);
        $this->assertSame(664.19, (float) $metric[0]->breakdown['fare']);
        // Monday 2026-11-02 04:00 Berlin (CET, UTC+1) -> next Monday 04:00, sent as STRINGS.
        Http::assertSent(function (Request $r) {
            $range = $r['variables']['timeRange'];

            return $range['startTimeUnixMillis'] === (string) CarbonImmutable::parse('2026-11-02 04:00', 'Europe/Berlin')->getTimestampMs()
                && $range['endTimeUnixMillis'] === (string) CarbonImmutable::parse('2026-11-09 04:00', 'Europe/Berlin')->getTimestampMs();
        });
    }

    public function test_before_four_am_monday_still_belongs_to_the_previous_week(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-11-02 03:00', 'Europe/Berlin'));
        $tenant = $this->tenant();
        Http::fake(['*/graphql' => Http::response($this->earningsPage([]))]);

        app(EarningsSync::class)->syncTenant($tenant);

        Http::assertSent(fn (Request $r) => $r['variables']['timeRange']['startTimeUnixMillis']
            === (string) CarbonImmutable::parse('2026-10-26 04:00', 'Europe/Berlin')->getTimestampMs());
    }

    public function test_vehicles_job_upserts_vehicles_from_search_vehicles(): void
    {
        $tenant = $this->tenant();
        Http::fake(['*/graphql' => Http::response(['data' => ['SearchSupplierVehicles' => ['vehicles' => [[
            'uuid' => 'veh-1', 'make' => 'Toyota', 'model' => 'Prius', 'year' => 2022, 'licensePlate' => 'B-AB 123',
            'vin' => 'VIN1', 'color' => 'Black', 'colorHexCode' => '000000', 'imageURL' => 'https://img/p.png',
            'compliance' => ['status' => 'COMPLIANT'], 'assignments' => [['entityUUID' => 'u-ahmed']],
        ], ['uuid' => 'veh-2', 'imageURL' => 'http://insecure/x.png']]]]])]);

        (new SyncTenantVehicles($tenant->id))->handle(app(VehicleSync::class));

        $v = Vehicle::withoutGlobalScopes()->where('tenant_id', $tenant->id)->where('uber_vehicle_uuid', 'veh-1')->firstOrFail();
        $this->assertSame('Toyota', $v->make);
        $this->assertSame('B-AB 123', $v->license_plate);
        $this->assertSame('#000000', $v->color_hex);
        $this->assertSame('COMPLIANT', $v->compliance_status);
        $this->assertSame('u-ahmed', $v->assigned_driver_uuid);
        $this->assertNotNull($v->synced_at);
        $this->assertNull(Vehicle::withoutGlobalScopes()->where('uber_vehicle_uuid', 'veh-2')->firstOrFail()->image_url, 'http images are dropped');
        Http::assertSent(fn (Request $r) => $r['operationName'] === 'SearchVehicles'
            && $r['variables']['orgUUID'] === 'org-'.$tenant->id
            && $r['variables']['withAssignments'] === true
            && str_contains($r->header('cookie')[0], 'sid=hub'));
    }

    public function test_a_403_is_a_session_rejection_with_one_call_and_no_retry(): void
    {
        $tenant = $this->tenant();
        Http::fake(['*/graphql' => Http::response('', 403)]);

        (new SyncTenantEarnings($tenant->id))->handle(app(EarningsSync::class));
        (new SyncTenantVehicles($tenant->id))->handle(app(VehicleSync::class));

        Http::assertSentCount(2); // one per job, no loop
        $this->assertSame(0, DriverMetric::withoutGlobalScopes()->count());
        $this->assertSame(0, Vehicle::withoutGlobalScopes()->count());
        // The jar is never written back.
        $this->assertSame('hub', UberFleetSession::withoutGlobalScopes()->first()->supplier_cookies[0]['value']);
    }

    public function test_flag_off_makes_no_calls_and_queues_nothing(): void
    {
        config(['services.uber.server_sync' => false]);
        Queue::fake();
        $tenant = $this->tenant();
        Http::fake();

        $this->artisan('fleet:sync-earnings')->assertSuccessful();
        $this->artisan('fleet:sync-vehicles')->assertSuccessful();
        Queue::assertNothingPushed();

        (new SyncTenantEarnings($tenant->id))->handle(app(EarningsSync::class));
        (new SyncTenantVehicles($tenant->id))->handle(app(VehicleSync::class));
        Http::assertNothingSent();
    }

    public function test_commands_queue_one_job_per_eligible_tenant_only(): void
    {
        Queue::fake();
        $good = $this->tenant('Good');
        $this->tenant('NoSession', session: false);
        $this->tenant('NoProxy', proxy: false);
        $noJar = $this->tenant('NoJar');
        UberFleetSession::withoutGlobalScopes()->where('tenant_id', $noJar->id)->update(['supplier_cookies' => null]);
        $lapsed = $this->tenant('Lapsed');
        $lapsed->forceFill(['status' => 'disabled'])->save();

        $this->artisan('fleet:sync-earnings')->assertSuccessful();
        $this->artisan('fleet:sync-vehicles')->assertSuccessful();

        Queue::assertPushed(SyncTenantEarnings::class, 1);
        Queue::assertPushed(SyncTenantVehicles::class, 1);
        $this->assertSame([$good->id], app(FleetHubSessionResolver::class)->eligibleTenants()->pluck('id')->all());
    }

    public function test_only_companies_the_admin_enabled_are_eligible(): void
    {
        $on = $this->tenant('On');
        $this->tenant('Off', enabled: false);

        $this->assertSame([$on->id], app(FleetHubSessionResolver::class)->eligibleTenants()->pluck('id')->all());
    }

    public function test_super_admin_flips_the_flag_and_a_manager_is_forbidden(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = $this->tenant('Acme', enabled: false);

        $manager = User::create(['name' => 'M', 'email' => 'm@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);
        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/server-sync", ['enabled' => true])->assertForbidden();
        $this->assertFalse($tenant->refresh()->serverSyncEnabled());

        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.de', 'password' => Hash::make('password')]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/server-sync", ['enabled' => true])
            ->assertOk()->assertJsonPath('data.server_sync_enabled', true);
        $this->assertTrue($tenant->refresh()->serverSyncEnabled());

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/server-sync", [])->assertStatus(422);
        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/server-sync", ['enabled' => false])
            ->assertOk()->assertJsonPath('data.server_sync_enabled', false);
    }

    public function test_one_tenants_crash_does_not_escape_the_job(): void
    {
        $tenant = $this->tenant();
        Http::fake(['*/graphql' => Http::response('{"data":{}}')]);

        (new SyncTenantEarnings($tenant->id))->handle(app(EarningsSync::class));

        $this->assertSame(0, DriverMetric::withoutGlobalScopes()->count());
    }
}
