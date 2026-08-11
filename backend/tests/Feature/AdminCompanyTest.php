<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminCompanyTest extends TestCase
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

    public function test_non_super_admin_is_forbidden(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create([
            'name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
        $manager->assignRole('fleet_manager');

        Sanctum::actingAs($manager);
        $this->getJson('/api/v1/admin/companies')->assertForbidden();
    }

    public function test_super_admin_lists_companies_with_pool_proxy_flag(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $proxy = Proxy::create(['label' => 'P1', 'url' => 'http://user:secret@host:12323', 'capacity' => 5]);
        Tenant::create(['name' => 'Acme', 'country' => 'DE', 'proxy_id' => $proxy->id, 'proxy_url' => $proxy->url]);
        Tenant::create(['name' => 'Globex', 'country' => 'DE']);

        $res = $this->getJson('/api/v1/admin/companies')->assertOk();
        $res->assertJsonCount(2, 'data');

        $acme = collect($res->json('data'))->firstWhere('name', 'Acme');
        $this->assertTrue($acme['has_proxy']);
        $this->assertSame($proxy->id, $acme['proxy_id']);
        $this->assertStringNotContainsString('secret', json_encode($acme)); // creds never exposed
    }

    public function test_create_company_with_first_manager_in_one_call(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/v1/admin/companies', [
            'name' => 'NewCo', 'country' => 'DE',
            'manager_name' => 'Boss', 'manager_email' => 'boss@newco.de', 'manager_password' => 'password',
        ])->assertCreated();

        $tenant = Tenant::where('name', 'NewCo')->firstOrFail();
        $manager = User::where('email', 'boss@newco.de')->firstOrFail();
        $this->assertSame($tenant->id, $manager->tenant_id);
        $this->assertTrue($manager->hasRole('fleet_manager'));
    }

    public function test_detail_shows_pool_proxy_and_update_can_bind_and_clear_it(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $proxy = Proxy::create(['label' => 'P1', 'url' => 'http://u:p@host:1', 'capacity' => 5]);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);

        // Bind to a pool proxy → its URL is copied onto the tenant.
        $this->putJson("/api/v1/admin/companies/{$tenant->id}", ['proxy_id' => $proxy->id])
            ->assertOk()
            ->assertJsonPath('data.proxy_id', $proxy->id)
            ->assertJsonPath('data.proxy_label', 'P1');
        $this->assertSame('http://u:p@host:1', $tenant->fresh()->proxy_url);

        // Null clears it.
        $this->putJson("/api/v1/admin/companies/{$tenant->id}", ['proxy_id' => null])->assertOk();
        $this->assertNull($tenant->fresh()->proxy_id);
        $this->assertNull($tenant->fresh()->proxy_url);
    }
}
