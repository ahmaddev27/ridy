<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The fleet-owner surface (/api/v1/driver/fleet/*) of the driver app: only a
 * tenant-bound owner/manager reaches it, the browser-extension token never does,
 * and the read-only app token can never change the dashboard password.
 */
class FleetOwnerScopeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function user(string $role, string $email = 'owner@ya.de'): User
    {
        $user = User::create([
            'name' => 'Owner', 'email' => $email,
            'password' => Hash::make('secret123'), 'tenant_id' => $this->tenant->id,
        ]);
        $user->assignRole($role);

        return $user;
    }

    private function bearer(User $user, array $abilities): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$user->createToken('t', $abilities)->plainTextToken];
    }

    public function test_owner_app_token_cannot_change_the_dashboard_password(): void
    {
        $owner = $this->user('fleet_manager');
        $auth = $this->bearer($owner, ['fleet:read']);

        $this->patchJson('/api/v1/driver/fleet/me', ['name' => 'New Name', 'password' => 'hijacked123'], $auth)
            ->assertOk()
            ->assertJsonPath('data.name', 'New Name');

        $this->assertTrue(Hash::check('secret123', $owner->fresh()->password));
        $this->postJson('/api/v1/login', ['email' => 'owner@ya.de', 'password' => 'hijacked123'])
            ->assertStatus(422);
    }

    public function test_extension_token_is_refused_on_the_fleet_owner_group(): void
    {
        $owner = $this->user('fleet_manager');
        $auth = $this->bearer($owner, ['fleet-session:write']);

        $this->getJson('/api/v1/driver/fleet/offers', $auth)->assertForbidden();
        $this->patchJson('/api/v1/driver/fleet/me', ['name' => 'x'], $auth)->assertForbidden();
        $this->postJson('/api/v1/driver/fleet/devices', ['token' => 'x', 'platform' => 'android'], $auth)
            ->assertForbidden();
    }

    public function test_a_user_without_an_owner_role_is_signed_out_with_a_401(): void
    {
        $viewer = $this->user('viewer', 'viewer@ya.de');
        $auth = $this->bearer($viewer, ['fleet:read']);

        // 401 (not 403): app 1.0.4 treats only 401 as a dead session and shows
        // the login screen; a 403 left it on the offline screen forever.
        $this->getJson('/api/v1/driver/fleet/me', $auth)
            ->assertUnauthorized()->assertJsonPath('message', 'fleet_owner_only');
        $this->assertSame(0, $viewer->tokens()->count());

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/driver/fleet/offers', $auth)->assertUnauthorized();
    }

    public function test_an_owner_demoted_after_signing_in_is_signed_out(): void
    {
        $owner = $this->user('fleet_manager');
        $auth = $this->bearer($owner, ['fleet:read']);
        $this->getJson('/api/v1/driver/fleet/me', $auth)->assertOk();

        $owner->syncRoles(['viewer']);
        $this->app['auth']->forgetGuards();

        $this->getJson('/api/v1/driver/fleet/me', $auth)->assertUnauthorized();
        $this->assertSame(0, $owner->tokens()->count());
    }

    public function test_a_tenantless_user_is_still_refused_with_a_403(): void
    {
        $admin = User::create([
            'name' => 'Admin', 'email' => 'admin@reidey.de', 'password' => Hash::make('secret123'),
        ]);
        $auth = $this->bearer($admin, ['fleet:read']);

        $this->getJson('/api/v1/driver/fleet/me', $auth)->assertForbidden();
        $this->assertSame(1, $admin->tokens()->count());
    }

    public function test_owner_app_token_still_reaches_its_own_surface(): void
    {
        $owner = $this->user('fleet_manager');
        $auth = $this->bearer($owner, ['fleet:read']);

        $this->getJson('/api/v1/driver/fleet/me', $auth)->assertOk();
        $this->getJson('/api/v1/driver/fleet/home', $auth)->assertOk();
        $this->postJson('/api/v1/driver/fleet/devices', ['token' => 'own', 'platform' => 'android'], $auth)
            ->assertCreated();
        $this->deleteJson('/api/v1/driver/fleet/devices', ['token' => 'own'], $auth)->assertOk();
        $this->postJson('/api/v1/driver/fleet/logout', [], $auth)->assertOk();
    }
}
