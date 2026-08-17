<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Covers the authorization + guard behaviour of admin impersonation. The
 * session-identity swap itself relies on the SPA's Sanctum-stateful session,
 * which the API test harness does not attach, so the happy-path swap is
 * verified manually/in production; here we lock down who may call it and how it
 * refuses without a valid impersonation.
 */
class ImpersonationTest extends TestCase
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

    private function manager(Tenant $tenant, string $email = 'm@a.de'): User
    {
        $user = User::create([
            'name' => 'M', 'email' => $email, 'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    public function test_start_fails_when_company_has_no_user(): void
    {
        $admin = $this->superAdmin();
        $tenant = Tenant::create(['name' => 'Empty', 'country' => 'DE']);

        Sanctum::actingAs($admin);
        $this->postJson("/api/v1/admin/companies/{$tenant->id}/impersonate")->assertStatus(422);
    }

    public function test_manager_cannot_start_impersonation(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = $this->manager($tenant);

        Sanctum::actingAs($manager);
        $this->postJson("/api/v1/admin/companies/{$tenant->id}/impersonate")->assertForbidden();
    }

    public function test_stop_without_impersonation_conflicts(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = $this->manager($tenant);

        Sanctum::actingAs($manager);
        $this->postJson('/api/v1/impersonate/stop')->assertStatus(409);
    }

    public function test_me_defaults_to_not_impersonating(): void
    {
        $admin = $this->superAdmin();

        Sanctum::actingAs($admin);
        $this->getJson('/api/v1/me')->assertJsonPath('impersonating', false);
    }
}
