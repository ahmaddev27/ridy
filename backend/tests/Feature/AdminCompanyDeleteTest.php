<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminCompanyDeleteTest extends TestCase
{
    use RefreshDatabase;

    public function test_hard_delete_removes_the_company_and_all_its_data(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);

        $manager = User::create(['name' => 'M', 'email' => 'm@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'D', 'uber_driver_uuid' => 'u1']);
        UberFleetSession::create(['tenant_id' => $tenant->id, 'uber_org_uuid' => 'o1', 'cookies' => [], 'status' => 'active']);
        DispatchOffer::create(['tenant_id' => $tenant->id, 'driver_uuid' => 'u1', 'offer_uuid' => 'of1', 'received_at' => now(), 'raw_payload' => []]);

        app(TenantContext::class)->set(null);
        Sanctum::actingAs($admin);

        $this->deleteJson("/api/v1/admin/companies/{$tenant->id}")
            ->assertOk()
            ->assertJsonPath('data.deleted', true);

        $this->assertDatabaseMissing('tenants', ['id' => $tenant->id]);
        $this->assertDatabaseMissing('users', ['id' => $manager->id]);
        $this->assertDatabaseMissing('drivers', ['id' => $driver->id]);
        $this->assertSame(0, UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->count());
        $this->assertSame(0, DispatchOffer::withoutGlobalScopes()->where('tenant_id', $tenant->id)->count());

        // The super-admin (other tenant / null) is untouched.
        $this->assertDatabaseHas('users', ['id' => $admin->id]);
    }
}
