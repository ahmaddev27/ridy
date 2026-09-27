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
use Tests\TestCase;

/**
 * The `driver` guard must authenticate a Driver's bearer token and NOTHING else:
 * never a dashboard session (statefulApi), never a manager / owner-app / extension
 * PAT. Before this fix the Sanctum guard fell back to the `web` session, so a
 * dashboard user resolved as "driver #<their users.id>" — a foreign driver.
 */
class DriverGuardIsolationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Tenant $otherTenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->tenant('Mine');
        $this->otherTenant = $this->tenant('Other');
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function tenant(string $name): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    private function manager(): User
    {
        $user = User::create([
            'name' => 'Manager', 'email' => 'm@mine.de',
            'password' => Hash::make('secret123'), 'tenant_id' => $this->tenant->id,
        ]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    /** A driver in ANOTHER company whose id equals the manager's users.id. */
    private function foreignDriverWithId(int $id): Driver
    {
        $driver = new Driver;
        $driver->forceFill([
            'id' => $id, 'tenant_id' => $this->otherTenant->id,
            'name' => 'Foreign', 'email' => 'foreign@other.de', 'activated_at' => now(),
        ])->save();

        DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $this->otherTenant->id, 'driver_id' => $driver->id,
            'driver_uuid' => 'uuid-foreign', 'offer_uuid' => 'foreign-offer',
            'received_at' => now(), 'raw_payload' => [], 'status' => OfferStatus::Pending,
            'rider_first_name' => 'Secret',
        ]);

        return $driver;
    }

    public function test_dashboard_session_is_rejected_on_every_driver_route(): void
    {
        $manager = $this->manager();
        $this->foreignDriverWithId($manager->id);
        $offerId = DispatchOffer::withoutGlobalScopes()->value('id');

        $this->actingAs($manager, 'web');
        $headers = ['Referer' => config('app.url'), 'Origin' => config('app.url')];

        $this->getJson('/api/v1/driver/offers', $headers)->assertUnauthorized();
        $this->getJson('/api/v1/driver/offers/'.$offerId, $headers)->assertUnauthorized();
        $this->getJson('/api/v1/driver/me', $headers)->assertUnauthorized();
        $this->getJson('/api/v1/driver/stats', $headers)->assertUnauthorized();
        $this->patchJson('/api/v1/driver/me', ['name' => 'x'], $headers)->assertUnauthorized();
        $this->postJson('/api/v1/driver/devices', ['token' => 'hijack', 'platform' => 'android'], $headers)
            ->assertUnauthorized();
        $this->postJson('/api/v1/driver/broadcasting/auth', [
            'socket_id' => '1.1', 'channel_name' => 'private-driver.'.$manager->id,
        ], $headers)->assertUnauthorized();

        $this->assertDatabaseMissing('device_tokens', ['token' => 'hijack']);
    }

    public function test_manager_bearer_token_is_rejected_on_driver_routes(): void
    {
        $manager = $this->manager();
        $this->foreignDriverWithId($manager->id);

        foreach ([['*'], ['fleet:read'], ['fleet-session:write']] as $abilities) {
            $token = $manager->createToken('t', $abilities)->plainTextToken;
            $this->app['auth']->forgetGuards();

            $this->getJson('/api/v1/driver/offers', ['Authorization' => 'Bearer '.$token])
                ->assertUnauthorized();
        }
    }

    public function test_a_real_driver_token_still_works(): void
    {
        $driver = Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Omar',
            'email' => 'omar@mine.de', 'activated_at' => now(),
        ]);
        $token = $driver->createToken('driver-app')->plainTextToken;

        $this->getJson('/api/v1/driver/me', ['Authorization' => 'Bearer '.$token])
            ->assertOk()
            ->assertJsonPath('data.id', $driver->id);
    }

    public function test_driver_token_is_rejected_on_the_fleet_owner_group(): void
    {
        $driver = Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Omar',
            'email' => 'omar@mine.de', 'activated_at' => now(),
        ]);
        $token = $driver->createToken('driver-app')->plainTextToken;
        $auth = ['Authorization' => 'Bearer '.$token];

        foreach (['me', 'home', 'drivers', 'offers', 'stats'] as $path) {
            $this->app['auth']->forgetGuards();
            $status = $this->getJson('/api/v1/driver/fleet/'.$path, $auth)->status();
            $this->assertContains($status, [401, 403], "fleet/{$path} answered {$status}");
        }
    }
}
