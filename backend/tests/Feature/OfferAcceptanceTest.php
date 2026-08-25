<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OfferAcceptanceTest extends TestCase
{
    use RefreshDatabase;

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'activated_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);

        $manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);

        // These scenarios are a connected company (statuses come from its live session).
        UberFleetSession::withoutGlobalScopes()->create(['tenant_id' => $this->tenant->id, 'uber_org_uuid' => 'org1', 'cookies' => [['name' => 'a', 'value' => 'b']]]);
    }

    private function driver(): Driver
    {
        return Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Basel',
            'uber_driver_uuid' => self::DRIVER_UUID, 'online_status' => 'MONITORING_SUPPLY_STATUS_ONLINE',
        ]);
    }

    private function offer(array $overrides = []): DispatchOffer
    {
        return DispatchOffer::create(array_merge([
            'tenant_id' => $this->tenant->id,
            'driver_uuid' => self::DRIVER_UUID,
            'offer_uuid' => 'offer-'.uniqid(),
            'received_at' => now()->subMinute(),
            'raw_payload' => [],
        ], $overrides));
    }

    public function test_transition_to_on_trip_marks_the_last_offer_accepted(): void
    {
        $this->driver();
        $offer = $this->offer();

        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP']],
        ])->assertOk()->assertJsonPath('data.accepted', 1);

        $this->assertNotNull($offer->fresh()->accepted_at);
    }

    public function test_engaged_driver_stores_live_coordinates_offline_clears_them(): void
    {
        $this->driver();

        // EN_ROUTE with real coordinates + waypoints → stored for the map.
        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [[
                'driver_uuid' => self::DRIVER_UUID,
                'status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE',
                'latitude' => 51.335008, 'longitude' => 7.040565, 'heading' => 248.0,
                'waypoints' => [['lat' => 51.334988, 'lng' => 7.040563, 'type' => 'pickup']],
            ]],
        ])->assertOk();

        $live = $this->getJson('/api/v1/drivers/live')->assertOk();
        $live->assertJsonCount(1, 'data')->assertJsonPath('data.0.lat', 51.335008);

        // Going offline (0,0) clears the location → drops off the map.
        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_OFFLINE', 'latitude' => 0, 'longitude' => 0]],
        ])->assertOk();

        $this->getJson('/api/v1/drivers/live')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_transition_to_en_route_marks_acceptance_earliest(): void
    {
        // EN_ROUTE (heading to the rider) is the first sign of acceptance, before ON_TRIP.
        $this->driver();
        $offer = $this->offer();

        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE']],
        ])->assertOk()->assertJsonPath('data.accepted', 1);

        $this->assertNotNull($offer->fresh()->accepted_at);
    }

    public function test_en_route_then_on_trip_does_not_double_accept(): void
    {
        // Once engaged via EN_ROUTE, flipping to ON_TRIP is the same job — no re-accept.
        $this->driver()->update(['online_status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE']);
        $offer = $this->offer();

        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP']],
        ])->assertOk()->assertJsonPath('data.accepted', 0);

        $this->assertNull($offer->fresh()->accepted_at);
    }

    public function test_staying_on_trip_does_not_re_accept(): void
    {
        $this->driver()->update(['online_status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP']);
        $offer = $this->offer();

        // Already on trip -> no fresh transition -> nothing accepted.
        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP']],
        ])->assertOk()->assertJsonPath('data.accepted', 0);

        $this->assertNull($offer->fresh()->accepted_at);
    }

    public function test_going_online_without_a_trip_does_not_accept(): void
    {
        $this->driver()->update(['online_status' => 'MONITORING_SUPPLY_STATUS_OFFLINE']);
        $offer = $this->offer();

        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_ONLINE']],
        ])->assertOk()->assertJsonPath('data.accepted', 0);

        $this->assertNull($offer->fresh()->accepted_at);
    }

    public function test_stale_offers_are_not_accepted(): void
    {
        $this->driver();
        $offer = $this->offer(['received_at' => now()->subMinutes(30)]);

        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP']],
        ])->assertOk()->assertJsonPath('data.accepted', 0);

        $this->assertNull($offer->fresh()->accepted_at);
    }

    // ── Full lifecycle ───────────────────────────────────────────────────────

    private function postStatus(string $s): void
    {
        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => "MONITORING_SUPPLY_STATUS_{$s}"]],
        ])->assertOk();
    }

    public function test_en_route_accepts_then_on_trip_starts(): void
    {
        $this->driver();
        $offer = $this->offer();

        $this->postStatus('EN_ROUTE');
        $this->assertSame(OfferStatus::Accepted, $offer->fresh()->status);

        $this->postStatus('ON_TRIP');
        $started = $offer->fresh();
        $this->assertSame(OfferStatus::Started, $started->status);
        $this->assertNotNull($started->started_at);
    }

    public function test_completed_when_engaged_driver_returns_idle(): void
    {
        $this->driver();
        $offer = $this->offer();

        $this->postStatus('EN_ROUTE');   // accepted
        $this->postStatus('ON_TRIP');    // started
        $this->postStatus('ONLINE');     // back to available → completed

        $done = $offer->fresh();
        $this->assertSame(OfferStatus::Completed, $done->status);
        $this->assertNotNull($done->completed_at);
    }

    public function test_canceled_when_accepted_then_idle_without_a_trip(): void
    {
        $this->driver();
        $offer = $this->offer();

        $this->postStatus('EN_ROUTE');   // accepted
        $this->postStatus('OFFLINE');    // dropped before the trip began → canceled

        $c = $offer->fresh();
        $this->assertSame(OfferStatus::Canceled, $c->status);
        $this->assertNotNull($c->canceled_at);
    }

    public function test_garbage_location_timestamp_does_not_break_the_batch(): void
    {
        // An offline driver carried a bad ms timestamp that parses to year 0001,
        // which MySQL datetime rejects — it used to 500 the whole status batch.
        $driver = $this->driver();

        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [[
                'driver_uuid' => self::DRIVER_UUID,
                'status' => 'MONITORING_SUPPLY_STATUS_OFFLINE',
                'location_updated_at' => -62135596800000, // → year 0001
            ]],
        ])->assertOk();

        $driver->refresh();
        $this->assertNull($driver->location_updated_at);
        $this->assertSame('MONITORING_SUPPLY_STATUS_OFFLINE', $driver->online_status);
    }

    public function test_late_acceptance_overturns_a_timeout_rejection(): void
    {
        // The core prod bug: the expiry sweep marks an offer rejected within
        // seconds of its short accept window, but the driver's acceptance is only
        // detected a poll or two later — it must still attribute + overturn.
        $this->driver();
        $offer = $this->offer(['received_at' => now()->subMinutes(2), 'accept_window_seconds' => 10]);

        app(OfferLifecycle::class)->expirePending();
        $this->assertSame('rejected', $offer->fresh()->status->value);

        // The driver actually took it — seen now as ON_TRIP.
        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP']],
        ])->assertOk()->assertJsonPath('data.accepted', 1);

        $fresh = $offer->fresh();
        $this->assertNotNull($fresh->accepted_at);
        $this->assertSame('started', $fresh->status->value);
    }

    public function test_pending_offer_past_window_reads_as_rejected_in_the_list(): void
    {
        $this->driver();
        // A new offer to an already-on-trip driver that's never taken.
        $offer = $this->offer(['received_at' => now()->subMinutes(5), 'accept_window_seconds' => 30]);

        $res = $this->getJson('/api/v1/dispatch/offers')->assertOk();
        $row = collect($res->json('data'))->firstWhere('id', $offer->id);

        // Stored status is still pending (sweep hasn't run), but the UI shows rejected.
        $this->assertSame('pending', $offer->fresh()->status->value);
        $this->assertSame('rejected', $row['status']);
    }

    public function test_pending_offer_past_its_window_is_rejected(): void
    {
        $this->driver();
        $offer = $this->offer(['received_at' => now()->subMinutes(2), 'accept_window_seconds' => 5]);

        app(OfferLifecycle::class)->expirePending($this->tenant->id);

        $this->assertSame(OfferStatus::Rejected, $offer->fresh()->status);
    }

    public function test_pending_offer_is_held_while_the_driver_is_on_a_trip(): void
    {
        // Busy driver: their back-to-back offer must stay pending (not "not taken")
        // until they finish — otherwise it flickers rejected then accepted.
        $driver = $this->driver();
        $driver->update(['online_status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP']);
        $offer = $this->offer([
            'driver_id' => $driver->id,
            'received_at' => now()->subMinutes(2),
            'accept_window_seconds' => 5,
        ]);

        app(OfferLifecycle::class)->expirePending($this->tenant->id);
        $this->assertSame(OfferStatus::Pending, $offer->fresh()->status);

        // …but not forever: past the 2h hard cap it expires even while engaged.
        $offer->update(['received_at' => now()->subHours(3)]);
        app(OfferLifecycle::class)->expirePending($this->tenant->id);
        $this->assertSame(OfferStatus::Rejected, $offer->fresh()->status);
    }

    public function test_invalid_transition_is_a_noop(): void
    {
        $this->driver();
        $offer = $this->offer(); // pending

        // Can't jump straight to completed from pending.
        $this->assertFalse(app(OfferLifecycle::class)->complete($offer));
        $this->assertSame(OfferStatus::Pending, $offer->fresh()->status);
    }

    public function test_completing_is_idempotent_and_earnings_count_once(): void
    {
        $this->driver();
        $offer = $this->offer(['fare_amount' => 12.50]);

        $this->postStatus('EN_ROUTE');
        $this->postStatus('ON_TRIP');
        $this->postStatus('ONLINE');   // completed

        // A duplicated engage→idle cycle must not re-complete or re-earn.
        $lifecycle = app(OfferLifecycle::class);
        $this->assertFalse($lifecycle->complete($offer->fresh()));

        $earnings = (float) DispatchOffer::completed()->sum('fare_amount');
        $this->assertSame(12.5, $earnings);
    }

    public function test_stats_fold_pending_into_not_taken_and_earn_from_completed(): void
    {
        $this->offer(['accepted_at' => now(), 'status' => OfferStatus::Completed, 'fare_amount' => 20]);
        $this->offer(['accepted_at' => now(), 'status' => OfferStatus::Canceled, 'fare_amount' => 8]);
        $this->offer(['status' => OfferStatus::Rejected]);
        $this->offer(['status' => OfferStatus::Pending]);

        $this->getJson('/api/v1/dispatch/offers/stats')->assertOk()
            ->assertJsonPath('data.total', 4)
            ->assertJsonPath('data.accepted', 2)     // completed + canceled were taken
            ->assertJsonPath('data.declined', 2)     // rejected + pending
            ->assertJsonPath('data.completed', 1)
            ->assertJsonPath('data.acceptance_rate', 50)
            ->assertJsonPath('data.earnings', 20);   // completed only
    }

    public function test_acceptance_rate_is_zero_with_no_offers(): void
    {
        $this->getJson('/api/v1/dispatch/offers/stats')->assertOk()
            ->assertJsonPath('data.total', 0)
            ->assertJsonPath('data.acceptance_rate', 0)
            ->assertJsonPath('data.earnings', 0);
    }

    public function test_a_next_offer_is_accepted_after_completing_the_first(): void
    {
        $this->driver();
        $first = $this->offer();

        $this->postStatus('EN_ROUTE');
        $this->postStatus('ON_TRIP');
        $this->postStatus('ONLINE');   // first completed
        $this->assertSame(OfferStatus::Completed, $first->fresh()->status);

        // A second offer arrives and the driver takes it.
        $second = $this->offer();
        $this->postStatus('EN_ROUTE');
        $this->assertSame(OfferStatus::Accepted, $second->fresh()->status);
    }
}
