<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_me_requires_authentication(): void
    {
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_login_succeeds_and_me_returns_tenant_and_roles(): void
    {
        $this->seed(RolePermissionSeeder::class);

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create([
            'name' => 'Anna',
            'email' => 'anna@acme.de',
            'password' => Hash::make('password'),
            'tenant_id' => $tenant->id,
        ]);
        $user->assignRole('fleet_manager');

        $this->postJson('/api/v1/login', [
            'email' => 'anna@acme.de',
            'password' => 'password',
        ])->assertOk()->assertJsonPath('data.email', 'anna@acme.de');

        Sanctum::actingAs($user);

        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.tenant.name', 'Acme')
            ->assertJsonPath('data.roles.0', 'fleet_manager');
    }

    public function test_login_fails_with_invalid_credentials(): void
    {
        User::create([
            'name' => 'Anna',
            'email' => 'anna@acme.de',
            'password' => Hash::make('password'),
        ]);

        $this->postJson('/api/v1/login', [
            'email' => 'anna@acme.de',
            'password' => 'wrong-password',
        ])->assertStatus(422);
    }
}
