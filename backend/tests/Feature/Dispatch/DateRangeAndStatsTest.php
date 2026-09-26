<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Http\Requests\FleetDayRange;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Date filters are validated and span-capped (a malformed date used to 500, an
 * unbounded range built millions of zero-fill rows), the stats aggregate is one
 * pass, and the driver Home exposes the live pending offer.
 */
class DateRangeAndStatsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function manager(): User
    {
        $user = User::create(['name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    private function offer(array $o = []): DispatchOffer
    {
        return DispatchOffer::create(array_merge([
            'tenant_id' => $this->tenant->id, 'driver_uuid' => 'd1', 'offer_uuid' => 'o-'.uniqid(),
            'received_at' => now()->subHour(), 'raw_payload' => [], 'status' => OfferStatus::Pending,
        ], $o));
    }

    public function test_driver_stats_reject_malformed_and_unbounded_ranges(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'o@ya.de']);
        Sanctum::actingAs($driver, guard: 'driver');

        $this->getJson('/api/v1/driver/stats?from=abc')->assertStatus(422);
        $this->getJson('/api/v1/driver/stats?from=0001-01-01&to=9999-12-31')->assertStatus(422);

        $res = $this->getJson('/api/v1/driver/stats?from=2026-09-01&to=2026-09-07')->assertOk();
        $this->assertCount(7, $res->json('data.daily'));
        $this->getJson('/api/v1/driver/offers?from=nope')->assertStatus(422);
    }

    public function test_reversed_and_over_long_ranges_are_clamped_not_refused(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'o@ya.de']);
        Sanctum::actingAs($driver, guard: 'driver');

        // A custom range picked backwards reads as the same range forwards.
        $res = $this->getJson('/api/v1/driver/stats?from=2026-09-07&to=2026-09-01')->assertOk();
        $this->assertCount(7, $res->json('data.daily'));
        $this->getJson('/api/v1/driver/offers?from=2026-09-07&to=2026-09-01')->assertOk();

        // Longer than a year: the latest MAX_DAYS fleet-days, still bounded.
        $res = $this->getJson('/api/v1/driver/stats?from=2020-01-01&to=2026-09-07')->assertOk();
        $this->assertCount(FleetDayRange::MAX_DAYS, $res->json('data.daily'));
        $this->assertSame('2026-09-07', collect($res->json('data.daily'))->last()['date'] ?? null);
    }

    public function test_driver_home_exposes_the_live_pending_offer(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'o@ya.de', 'uber_driver_uuid' => 'd1']);
        $this->offer(['driver_id' => $driver->id, 'status' => OfferStatus::Rejected, 'received_at' => now()->subMinutes(3)]);
        $pending = $this->offer(['driver_id' => $driver->id, 'received_at' => now()->subSeconds(2)]);
        Sanctum::actingAs($driver, guard: 'driver');

        $this->getJson('/api/v1/driver/home')->assertOk()
            ->assertJsonPath('data.pending_offer.id', $pending->id)
            ->assertJsonPath('data.active_offer', null);
    }

    public function test_driver_home_pending_offer_is_null_without_a_live_offer(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'o@ya.de']);
        $this->offer(['driver_id' => $driver->id, 'received_at' => now()->subHour()]); // long gone
        Sanctum::actingAs($driver, guard: 'driver');

        $this->getJson('/api/v1/driver/home')->assertOk()->assertJsonPath('data.pending_offer', null);
    }

    public function test_manager_offer_filters_are_validated(): void
    {
        Sanctum::actingAs($this->manager());

        $this->getJson('/api/v1/dispatch/offers?from=abc')->assertStatus(422);
        $this->getJson('/api/v1/dispatch/offers/stats?to=31.12.2026')->assertStatus(422);
        $this->getJson('/api/v1/dispatch/offers?driver_uuids[0][x]=1')->assertStatus(422);
        $this->getJson('/api/v1/dispatch/offers?from=2026-01-01')->assertOk();
    }

    public function test_offer_stats_are_computed_in_one_pass(): void
    {
        $this->offer(['accepted_at' => now(), 'status' => OfferStatus::Completed, 'fare_amount' => 10.5]);
        $this->offer(['accepted_at' => now(), 'status' => OfferStatus::Completed, 'fare_amount' => 4.25]);
        $this->offer(['accepted_at' => now(), 'status' => OfferStatus::Canceled, 'fare_amount' => 99]);
        $this->offer(['status' => OfferStatus::Rejected, 'fare_amount' => 50]);
        Sanctum::actingAs($this->manager());

        $this->getJson('/api/v1/dispatch/offers/stats')->assertOk()
            ->assertJsonPath('data.total', 4)
            ->assertJsonPath('data.accepted', 3)
            ->assertJsonPath('data.declined', 1)
            ->assertJsonPath('data.completed', 2)
            ->assertJsonPath('data.acceptance_rate', 75)
            ->assertJsonPath('data.earnings', 14.75);
    }

    public function test_csv_export_uses_the_numeric_fare_when_the_formatted_one_is_blank(): void
    {
        $this->offer(['fare_formatted' => null, 'fare_amount' => 12.34, 'distance_m' => 2000]);
        Sanctum::actingAs($this->manager());

        $csv = $this->get('/api/v1/dispatch/offers/export')->assertOk()->streamedContent();

        $this->assertStringContainsString('12.34', $csv);
        $this->assertStringContainsString('6.17', $csv); // €/km = 12.34 / 2.0
    }

    public function test_server_side_roster_pull_never_calls_uber(): void
    {
        Http::fake();
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => '7b118561-0f8e-4816-a93f-d6e9c770cfd0', 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        $this->tenant->forceFill(['uber_org_uuid' => '7b118561-0f8e-4816-a93f-d6e9c770cfd0'])->save();
        Sanctum::actingAs($this->manager());

        $this->postJson('/api/v1/drivers/sync')->assertOk()->assertJsonPath('data.reason', 'extension_required');
        Http::assertNothingSent();
    }
}
