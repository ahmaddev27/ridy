<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
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

class FleetAutoDeclineTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Driver $on;

    private Driver $off;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
            'settings' => ['dispatch_reject' => ['enabled' => true]],
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->on = Driver::create(['name' => 'Anna', 'uber_driver_uuid' => 'd-1', 'auto_decline' => [
            'enabled' => true,
            'rules' => ['min_fare' => ['enabled' => true, 'value_e2' => 900]],
        ]]);
        $this->off = Driver::create(['name' => 'Bernd', 'uber_driver_uuid' => 'd-2']);
        $manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);
    }

    private function offer(string $uuid, Driver $driver, ?string $reason, array $extra = []): DispatchOffer
    {
        $offer = DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id,
            'driver_id' => $driver->id,
            'driver_uuid' => $driver->uber_driver_uuid,
            'offer_uuid' => $uuid,
            'received_at' => now(),
            'status' => OfferStatus::Rejected,
            'raw_payload' => [],
        ]);
        // Not mass-assignable: only the engine stamps these.
        $offer->forceFill(['auto_decline_reason' => $reason] + $extra)->save();

        return $offer;
    }

    public function test_lists_only_drivers_with_early_decline_enabled_and_their_rules(): void
    {
        $this->getJson('/api/v1/auto-decline')
            ->assertOk()
            ->assertJsonPath('data.feature_enabled', true)
            ->assertJsonCount(1, 'data.drivers')
            ->assertJsonPath('data.drivers.0.name', 'Anna')
            ->assertJsonPath('data.drivers.0.rules.min_fare.value_e2', 900)
            ->assertJsonPath('data.drivers.0.rules.reject_cities.enabled', false);
    }

    public function test_history_is_fleet_wide_and_filters_by_driver_and_reason(): void
    {
        $this->offer('o1', $this->on, 'min_fare');
        $this->offer('o2', $this->on, 'reject_cities');
        $this->offer('o3', $this->off, 'min_fare');
        $this->offer('o4', $this->on, null);
        $this->offer('o5', $this->on, 'min_fare', ['auto_decline_failed_at' => now()]);

        $this->getJson('/api/v1/auto-decline/history')->assertOk()->assertJsonCount(3, 'data');
        $this->getJson('/api/v1/auto-decline/history?driver_id='.$this->on->id)->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/auto-decline/history?reason=min_fare')->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/auto-decline/history?reason=nope')->assertUnprocessable();
    }

    public function test_history_honours_the_date_range(): void
    {
        $this->offer('old', $this->on, 'min_fare', ['received_at' => now()->subDays(10)]);
        $this->offer('new', $this->on, 'min_fare');

        $from = now()->subDay()->toDateString();
        $this->getJson("/api/v1/auto-decline/history?from={$from}")->assertJsonCount(1, 'data');
    }

    public function test_other_tenants_data_is_never_visible(): void
    {
        $other = Tenant::create(['name' => 'Other', 'country' => 'DE', 'settings' => ['dispatch_reject' => ['enabled' => true]]]);
        $stranger = Driver::withoutGlobalScopes()->create([
            'tenant_id' => $other->id, 'name' => 'Zoe', 'uber_driver_uuid' => 'x-1',
            'auto_decline' => ['enabled' => true, 'rules' => []],
        ]);
        $theirs = DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $other->id, 'driver_id' => $stranger->id, 'driver_uuid' => 'x-1', 'offer_uuid' => 'ox',
            'received_at' => now(), 'status' => OfferStatus::Rejected, 'raw_payload' => [],
        ]);
        $theirs->forceFill(['auto_decline_reason' => 'min_fare'])->save();

        $this->getJson('/api/v1/auto-decline')->assertJsonCount(1, 'data.drivers');
        $this->getJson('/api/v1/auto-decline/history')->assertJsonCount(0, 'data');
    }
}
