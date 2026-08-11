<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use App\Support\Settings;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminPlatformTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_settings_save_hides_secrets_and_persists(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->putJson('/api/v1/admin/settings', [
            'smtp_host' => 'smtp.mailtrap.io',
            'smtp_port' => 587,
            'smtp_password' => 'topsecret',
        ])->assertOk()
            ->assertJsonPath('data.smtp_host', 'smtp.mailtrap.io')
            ->assertJsonPath('data.has_smtp_password', true);

        // Secrets are never returned in full.
        $res = $this->getJson('/api/v1/admin/settings')->assertOk();
        $this->assertStringNotContainsString('topsecret', $res->getContent());

        // But they are stored (decrypted via the helper).
        $this->assertSame('topsecret', Settings::get('smtp_password'));
    }

    public function test_manager_cannot_reach_admin_settings(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $m = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $m->assignRole('fleet_manager');

        Sanctum::actingAs($m);
        $this->getJson('/api/v1/admin/settings')->assertForbidden();
        $this->getJson('/api/v1/admin/overview')->assertForbidden();
    }

    public function test_user_updates_own_profile(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $m = User::create(['name' => 'Old', 'email' => 'old@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $m->assignRole('fleet_manager');

        Sanctum::actingAs($m);
        $this->putJson('/api/v1/profile', ['name' => 'New Name', 'email' => 'new@a.de'])
            ->assertOk()
            ->assertJsonPath('data.name', 'New Name')
            ->assertJsonPath('data.email', 'new@a.de');
    }
}
