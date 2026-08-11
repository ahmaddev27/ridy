<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
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
}
