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

    public function test_only_a_super_admin_may_switch_dispatch_declines_for_a_company(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create([
            'name' => 'M', 'email' => 'm@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
        $manager->assignRole('fleet_manager');

        // The only feature that writes to Uber: a company must never be able to
        // open it for itself, however senior the role inside that company.
        Sanctum::actingAs($manager);
        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/dispatch-reject", ['enabled' => true])
            ->assertForbidden();

        $this->assertFalse($tenant->refresh()->dispatchRejectEnabled());
    }

    public function test_a_company_starts_with_dispatch_declines_closed_and_the_operator_opens_it(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);

        // Absent means OFF, so every company that predates the feature is closed.
        $this->getJson("/api/v1/admin/companies/{$tenant->id}")
            ->assertOk()
            ->assertJsonPath('data.dispatch_reject_enabled', false);

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/dispatch-reject", ['enabled' => true])
            ->assertOk()
            ->assertJsonPath('data.dispatch_reject_enabled', true);
        $this->assertTrue($tenant->refresh()->dispatchRejectEnabled());

        // And closing it again is the kill switch — it must work at any moment.
        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/dispatch-reject", ['enabled' => false])
            ->assertOk()
            ->assertJsonPath('data.dispatch_reject_enabled', false);
        $this->assertFalse($tenant->refresh()->dispatchRejectEnabled());
    }

    public function test_the_dispatch_decline_switch_leaves_other_company_settings_alone(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $tenant->setElprofessorEnabled(true);

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/dispatch-reject", ['enabled' => true])
            ->assertOk();

        // Both switches live in the same settings JSON column, so one must not
        // overwrite the other's key on its way in.
        $tenant->refresh();
        $this->assertTrue($tenant->dispatchRejectEnabled());
        $this->assertTrue($tenant->elprofessorEnabled());
    }

    public function test_the_dispatch_decline_switch_requires_an_explicit_boolean(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/dispatch-reject", [])
            ->assertStatus(422);

        $this->assertFalse($tenant->refresh()->dispatchRejectEnabled());
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
