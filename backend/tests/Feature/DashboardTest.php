<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_summary_returns_tenant_scoped_counts(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create([
            'name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);

        app(TenantContext::class)->set($tenant->id);
        Driver::create(['name' => 'Ahmed Hemaid', 'uber_driver_uuid' => 'c0c5a2e2']);
        Driver::create(['name' => 'Mhmoud Zedya']); // unlinked

        Sanctum::actingAs($user);

        $this->getJson('/api/v1/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.drivers', 2)
            ->assertJsonPath('data.linked_drivers', 1)
            ->assertJsonPath('data.offers_today', 0)
            ->assertJsonPath('data.unlinked_offers', 0);
    }
}
