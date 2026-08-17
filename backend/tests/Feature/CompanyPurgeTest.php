<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CompanyPurgeTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create([
            'name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null,
        ]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    private function seedFleet(Tenant $tenant): Driver
    {
        $driver = Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'Ali', 'uber_driver_uuid' => 'uuid-1',
        ]);
        DeviceToken::create([
            'tenant_id' => $tenant->id, 'driver_id' => $driver->id, 'token' => 'tok', 'platform' => 'android',
        ]);
        DispatchOffer::create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'uuid-1', 'offer_uuid' => 'o-1',
            'received_at' => now(), 'raw_payload' => ['x' => 1],
        ]);
        UberFleetSession::create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-1', 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);

        return $driver;
    }

    public function test_super_admin_purges_all_company_fleet_data(): void
    {
        $admin = $this->superAdmin();
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $this->seedFleet($tenant);

        Sanctum::actingAs($admin);
        $this->deleteJson("/api/v1/admin/companies/{$tenant->id}/data")
            ->assertOk()
            ->assertJsonPath('data.drivers', 1)
            ->assertJsonPath('data.offers', 1)
            ->assertJsonPath('data.sessions', 1)
            ->assertJsonPath('data.device_tokens', 1);

        $this->assertDatabaseCount('drivers', 0);
        $this->assertDatabaseCount('dispatch_offers', 0);
        $this->assertDatabaseCount('uber_fleet_sessions', 0);
        $this->assertDatabaseCount('device_tokens', 0);
        // The company + its account survive.
        $this->assertDatabaseHas('tenants', ['id' => $tenant->id]);
    }

    public function test_manager_cannot_purge(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create([
            'name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
        $manager->assignRole('fleet_manager');

        Sanctum::actingAs($manager);
        $this->deleteJson("/api/v1/admin/companies/{$tenant->id}/data")->assertForbidden();
    }
}
