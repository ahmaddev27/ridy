<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrphanDriverTest extends TestCase
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

    public function test_lists_only_drivers_dropped_from_their_roster(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        // Still on the roster — must NOT appear.
        Driver::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'name' => 'On Roster', 'roster_removed_at' => null,
        ]);
        // Dropped from the roster — the orphan we want, with contact details.
        Driver::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'name' => 'Dropped Driver', 'phone' => '+49 170 1234567',
            'uber_email' => 'dropped@uber.com', 'activated_at' => now(), 'roster_removed_at' => now(),
        ]);

        Sanctum::actingAs($this->superAdmin());
        $res = $this->getJson('/api/v1/admin/orphan-drivers')->assertOk();

        $res->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.name', 'Dropped Driver')
            ->assertJsonPath('data.0.phone', '+49 170 1234567')
            ->assertJsonPath('data.0.former_company', 'Acme')
            ->assertJsonPath('data.0.app_registered', true);
    }

    public function test_search_matches_contact_fields(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        Driver::withoutGlobalScopes()->create(['tenant_id' => $tenant->id, 'name' => 'Alpha', 'roster_removed_at' => now()]);
        Driver::withoutGlobalScopes()->create(['tenant_id' => $tenant->id, 'name' => 'Beta', 'roster_removed_at' => now()]);

        Sanctum::actingAs($this->superAdmin());
        $this->getJson('/api/v1/admin/orphan-drivers?search=Alph')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.name', 'Alpha');
    }

    public function test_requires_super_admin(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create([
            'name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
        $manager->assignRole('fleet_manager');

        Sanctum::actingAs($manager);
        $this->getJson('/api/v1/admin/orphan-drivers')->assertForbidden();
    }
}
