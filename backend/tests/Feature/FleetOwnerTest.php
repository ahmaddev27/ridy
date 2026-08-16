<?php

namespace Tests\Feature;

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

/**
 * Fleet-owner mode: a dashboard manager/owner signing into the driver app and
 * monitoring every driver's offers read-only.
 */
class FleetOwnerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA Mobility', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function owner(array $overrides = []): User
    {
        $user = User::create(array_merge([
            'name' => 'Owner', 'email' => 'owner@ya.de',
            'password' => Hash::make('secret123'), 'tenant_id' => $this->tenant->id,
        ], $overrides));
        $user->assignRole('fleet_manager');

        return $user;
    }

    private function driver(array $overrides = []): Driver
    {
        return Driver::create(array_merge([
            'tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'omar@ya.de',
        ], $overrides));
    }

    private function offer(Driver $driver, string $uuid, array $overrides = []): DispatchOffer
    {
        return DispatchOffer::create(array_merge([
            'tenant_id' => $driver->tenant_id,
            'driver_id' => $driver->id,
            'driver_uuid' => 'uuid-'.$driver->id,
            'offer_uuid' => $uuid,
            'received_at' => now(),
            'raw_payload' => [],
            'status' => OfferStatus::Pending,
        ], $overrides));
    }

    public function test_manager_logs_into_the_app_with_dashboard_credentials(): void
    {
        $this->owner();

        $this->postJson('/api/v1/driver/login', ['email' => 'owner@ya.de', 'password' => 'secret123'])
            ->assertOk()
            ->assertJsonPath('data.is_owner', true)
            ->assertJsonPath('data.owner.company_name', 'YA Mobility')
            ->assertJsonStructure(['data' => ['token', 'owner' => ['name', 'company_name']]]);
    }

    public function test_fleet_offers_returns_every_drivers_offers_for_the_tenant(): void
    {
        $owner = $this->owner();
        $a = $this->driver(['name' => 'Omar', 'email' => 'omar@ya.de']);
        $b = $this->driver(['name' => 'Sara', 'email' => 'sara@ya.de']);
        $this->offer($a, 'a1');
        $this->offer($b, 'b1');

        // Another tenant's offer must never leak.
        $other = Tenant::create(['name' => 'Other', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth()]);
        app(TenantContext::class)->set($other->id);
        $stranger = Driver::create(['tenant_id' => $other->id, 'name' => 'Stranger', 'email' => 's@o.de']);
        $this->offer($stranger, 'x1');
        app(TenantContext::class)->set($this->tenant->id);

        Sanctum::actingAs($owner);
        $res = $this->getJson('/api/v1/driver/fleet/offers')->assertOk();

        $this->assertCount(2, $res->json('data'));
        $names = collect($res->json('data'))->pluck('driver_name')->sort()->values()->all();
        $this->assertSame(['Omar', 'Sara'], $names);
    }

    public function test_fleet_home_reports_tenant_wide_today_and_online_drivers(): void
    {
        $owner = $this->owner();
        $a = $this->driver(['name' => 'Omar', 'email' => 'omar@ya.de', 'online_status' => 'ONLINE']);
        $b = $this->driver(['name' => 'Sara', 'email' => 'sara@ya.de']);
        $this->offer($a, 'a1', ['status' => OfferStatus::Completed, 'accepted_at' => now(), 'fare_amount' => 10]);
        $this->offer($b, 'b1', ['status' => OfferStatus::Started, 'accepted_at' => now()]);

        Sanctum::actingAs($owner);
        $res = $this->getJson('/api/v1/driver/fleet/home')->assertOk();

        $res->assertJsonPath('data.today.total', 2)
            ->assertJsonPath('data.today.accepted', 2)
            ->assertJsonPath('data.today.completed', 1)
            ->assertJsonPath('data.today.earnings', 10)
            ->assertJsonPath('data.online_drivers', 1)
            ->assertJsonPath('data.owner.company_name', 'YA Mobility');
        $this->assertCount(2, $res->json('data.recent'));
        $this->assertCount(1, $res->json('data.active_offers'));
    }

    public function test_plain_driver_still_sees_only_their_own_offers(): void
    {
        $mine = $this->driver(['activated_at' => now()]);
        $other = $this->driver(['email' => 'x@ya.de']);
        $this->offer($mine, 'off-1');
        $this->offer($other, 'off-2');

        Sanctum::actingAs($mine, guard: 'driver');
        $res = $this->getJson('/api/v1/driver/offers')->assertOk();

        $this->assertCount(1, $res->json('data'));
    }

    public function test_suspended_tenant_blocks_manager_login(): void
    {
        $this->owner();
        $this->tenant->forceFill(['subscription_ends_at' => now()->subDay()])->save();

        $this->postJson('/api/v1/driver/login', ['email' => 'owner@ya.de', 'password' => 'secret123'])
            ->assertStatus(403)
            ->assertJsonPath('message', 'account_suspended');
    }

    public function test_tenant_less_user_cannot_use_fleet_endpoints(): void
    {
        $reseller = User::create(['name' => 'R', 'email' => 'r@x.de', 'password' => Hash::make('secret123')]);
        $reseller->assignRole('reseller');

        Sanctum::actingAs($reseller);
        $this->getJson('/api/v1/driver/fleet/offers')->assertStatus(403);
    }
}
