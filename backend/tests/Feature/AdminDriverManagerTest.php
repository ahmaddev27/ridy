<?php

namespace Tests\Feature;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDriverManagerTest extends TestCase
{
    use RefreshDatabase;

    private function actAs(string $role, ?int $tenantId): void
    {
        $this->seed(RolePermissionSeeder::class);
        $user = User::create(['name' => 'U', 'email' => $role.'@x.de', 'password' => Hash::make('password'), 'tenant_id' => $tenantId]);
        $user->assignRole($role);
        Sanctum::actingAs($user);
    }

    private function driver(Tenant $tenant): Driver
    {
        return Driver::withoutGlobalScopes()->create(['tenant_id' => $tenant->id, 'name' => 'Anna', 'email' => 'a@x.de', 'uber_driver_uuid' => 'u-'.$tenant->id]);
    }

    public function test_super_admin_toggles_manager_and_it_is_audited(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $driver = $this->driver($tenant);
        $this->actAs('super_admin', null);

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/drivers/{$driver->id}/manager", ['is_manager' => true])
            ->assertOk()->assertJsonPath('data.is_manager', true);

        $this->assertTrue((bool) $driver->fresh()->is_manager);
        $this->assertSame(1, AuditLog::query()->where('action', 'driver.manager_enabled')->where('tenant_id', $tenant->id)->count());
    }

    public function test_driver_of_another_company_is_not_found(): void
    {
        $a = Tenant::create(['name' => 'A', 'country' => 'DE']);
        $b = Tenant::create(['name' => 'B', 'country' => 'DE']);
        $driver = $this->driver($b);
        $this->actAs('super_admin', null);

        $this->patchJson("/api/v1/admin/companies/{$a->id}/drivers/{$driver->id}/manager", ['is_manager' => true])->assertNotFound();
    }

    public function test_company_manager_is_forbidden(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $driver = $this->driver($tenant);
        $this->actAs('fleet_manager', $tenant->id);

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/drivers/{$driver->id}/manager", ['is_manager' => true])->assertForbidden();
        $this->assertFalse((bool) $driver->fresh()->is_manager);
    }
}
