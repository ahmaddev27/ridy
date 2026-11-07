<?php

namespace Tests\Feature;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Auth\Webauthn\CeremonyVerifier;
use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Domain\Auth\Webauthn\VerifiedRegistration;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use LogicException;
use Tests\TestCase;

/** Phase A of "owner who also drives": the owner-driver link and the login mapping. */
class OwnerDriverLinkTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('Acme');
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function makeTenant(string $name): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    private function user(string $role = 'owner', string $email = 'boss@acme.de'): User
    {
        $user = User::create(['name' => 'Boss', 'email' => $email, 'password' => bcrypt('x'), 'tenant_id' => $this->tenant->id]);
        $user->assignRole($role);

        return $user;
    }

    private function driver(array $o = [], ?Tenant $tenant = null): Driver
    {
        return Driver::withoutGlobalScopes()->create(array_merge([
            'tenant_id' => ($tenant ?? $this->tenant)->id, 'name' => 'Boss Driver', 'uber_driver_uuid' => 'u-'.uniqid(),
        ], $o));
    }

    private function link(User $owner, Driver $driver, bool $linked = true): TestResponse
    {
        Sanctum::actingAs($owner);

        return $this->patchJson("/api/v1/drivers/{$driver->id}/owner-link", ['linked' => $linked]);
    }

    private function otpLogin(string $email): TestResponse
    {
        $this->postJson('/api/v1/driver/login/request', ['email' => $email])->assertOk();

        return $this->postJson('/api/v1/driver/login/verify', ['email' => $email, 'otp' => '111111']);
    }

    // --- schema ------------------------------------------------------------------------

    public function test_user_id_is_unique_per_tenant(): void
    {
        $this->assertTrue(Schema::hasColumn('drivers', 'user_id'));
        $owner = $this->user();
        $this->driver()->forceFill(['user_id' => $owner->id])->save();

        $this->expectException(QueryException::class);
        $this->driver()->forceFill(['user_id' => $owner->id])->save();
    }

    public function test_deleting_the_user_nulls_the_link(): void
    {
        $owner = $this->user();
        $driver = $this->driver();
        $driver->forceFill(['user_id' => $owner->id])->save();

        $owner->delete();

        $this->assertNull($driver->fresh()->user_id);
    }

    // --- link endpoint -----------------------------------------------------------------

    public function test_owner_links_and_unlinks_with_audit(): void
    {
        $owner = $this->user();
        $driver = $this->driver();

        $this->link($owner, $driver)->assertOk()
            ->assertJsonPath('data.owner_linked', true)->assertJsonPath('data.is_me', true)->assertJsonPath('data.is_manager', true);
        $this->assertSame($owner->id, $driver->fresh()->user_id);
        $this->assertSame(1, AuditLog::query()->where('action', 'driver.owner_linked')->count());

        $this->link($owner, $driver, false)->assertOk()->assertJsonPath('data.owner_linked', false);
        $fresh = $driver->fresh();
        $this->assertNull($fresh->user_id);
        $this->assertFalse((bool) $fresh->is_manager);
        $this->assertSame(1, AuditLog::query()->where('action', 'driver.owner_unlinked')->count());
    }

    public function test_fleet_manager_cannot_link(): void
    {
        $this->link($this->user('fleet_manager'), $this->driver())->assertForbidden();
    }

    public function test_cross_tenant_driver_is_not_found(): void
    {
        $other = $this->driver([], $this->makeTenant('Other'));

        $this->link($this->user(), $other)->assertNotFound();
    }

    public function test_conflicts_are_409(): void
    {
        $owner = $this->user();
        $mine = $this->driver();
        $this->link($owner, $mine)->assertOk();

        $this->link($owner, $this->driver())->assertStatus(409)->assertJsonPath('message', 'already_linked');

        $second = $this->user('owner', 'second@acme.de');
        $this->link($second, $mine)->assertStatus(409)->assertJsonPath('message', 'driver_linked_to_other');
    }

    public function test_another_driver_with_the_owners_email_blocks_the_link(): void
    {
        $owner = $this->user();
        $this->driver(['email' => 'boss@acme.de']);

        $this->link($owner, $this->driver())->assertStatus(409)->assertJsonPath('message', 'email_belongs_to_other_driver');
    }

    public function test_the_link_owns_the_manager_flag(): void
    {
        $owner = $this->user();
        $driver = $this->driver();
        $this->link($owner, $driver)->assertOk();

        $this->patchJson("/api/v1/drivers/{$driver->id}/manager", ['is_manager' => false])
            ->assertForbidden()->assertJsonPath('message', 'cannot_change_own_manager_flag');

        Sanctum::actingAs($this->user('owner', 'second@acme.de'));
        $this->patchJson("/api/v1/drivers/{$driver->id}/manager", ['is_manager' => false])
            ->assertStatus(409)->assertJsonPath('message', 'managed_by_link');

        $admin = User::create(['name' => 'SA', 'email' => 'sa@x.de', 'password' => bcrypt('x'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
        $this->patchJson("/api/v1/admin/companies/{$this->tenant->id}/drivers/{$driver->id}/manager", ['is_manager' => false])
            ->assertStatus(409);
        $this->assertTrue((bool) $driver->fresh()->is_manager);
    }

    // --- sign-in -----------------------------------------------------------------------

    public function test_linked_owner_signs_in_as_a_driver_with_admin_capability(): void
    {
        $owner = $this->user();
        $driver = $this->driver();
        $this->link($owner, $driver)->assertOk();

        $res = $this->otpLogin('boss@acme.de')->assertOk()
            ->assertJsonPath('data.is_owner', false)
            ->assertJsonPath('data.driver.id', $driver->id)
            ->assertJsonPath('data.driver.admin_capable', true)
            ->assertJsonPath('data.driver.owner_linked', true);

        $this->assertNotNull($driver->fresh()->activated_at);
        $this->assertSame(0, $owner->tokens()->where('name', 'driver-app-owner')->count());
        $this->assertNotEmpty($res->json('data.token'));
    }

    public function test_unlinked_owner_keeps_the_read_only_token(): void
    {
        $owner = $this->user();

        $this->otpLogin('boss@acme.de')->assertOk()->assertJsonPath('data.is_owner', true);
        $this->assertSame(['fleet:read'], $owner->tokens()->sole()->abilities);
    }

    public function test_demoted_owner_loses_capability(): void
    {
        $owner = $this->user();
        $driver = $this->driver();
        $this->link($owner, $driver)->assertOk();
        $this->assertTrue($driver->fresh()->adminCapable());

        $owner->syncRoles([]);

        $this->assertFalse($driver->fresh()->adminCapable());
        $this->assertTrue($driver->fresh()->isLinkedOwner());
    }

    public function test_driver_admin_middleware_answers_403_admin_revoked_not_401(): void
    {
        $owner = $this->user();
        $driver = $this->driver();
        $this->link($owner, $driver)->assertOk();
        Route::middleware(['auth:driver', 'driver.admin'])->get('/api/v1/_probe_admin', fn () => response()->json(['ok' => true]));

        Sanctum::actingAs($driver->fresh(), [], 'driver');
        $this->getJson('/api/v1/_probe_admin')->assertOk();

        $owner->syncRoles([]);
        Sanctum::actingAs($driver->fresh(), [], 'driver');
        $this->getJson('/api/v1/_probe_admin')->assertForbidden()->assertJsonPath('message', 'admin_revoked');
    }

    // --- passkeys ----------------------------------------------------------------------

    private function bindPassingVerifier(): void
    {
        $this->app->bind(CeremonyVerifier::class, fn () => new class implements CeremonyVerifier
        {
            public function verifyRegistration(string $optionsJson, array $credential): VerifiedRegistration
            {
                throw new LogicException('unused');
            }

            public function verifyAssertion(string $optionsJson, array $credential, WebauthnCredential $stored): int
            {
                return $stored->counter + 1;
            }
        });
    }

    private function passkeyLogin(string $id): TestResponse
    {
        return $this->postJson('/api/v1/driver/webauthn/login', [
            'ceremony_id' => $this->postJson('/api/v1/driver/webauthn/login/options')->json('ceremony_id'),
            'credential' => ['id' => $id, 'type' => 'public-key'],
        ]);
    }

    public function test_owner_passkey_yields_a_driver_token_when_linked(): void
    {
        $owner = $this->user();
        $this->link($owner, $this->driver())->assertOk();
        WebauthnCredential::factory()->app()->for($owner, 'authenticatable')->create(['id' => 'o-app']);
        $this->bindPassingVerifier();

        $this->passkeyLogin('o-app')->assertOk()
            ->assertJsonPath('data.is_owner', false)->assertJsonPath('data.driver.admin_capable', true);
    }

    public function test_driver_passkey_with_blank_email_needs_a_live_link(): void
    {
        $owner = $this->user();
        $driver = $this->driver();
        WebauthnCredential::factory()->app()->for($driver, 'authenticatable')->create(['id' => 'd-app']);
        $this->bindPassingVerifier();

        $this->passkeyLogin('d-app')->assertUnprocessable();

        $this->link($owner, $driver)->assertOk();
        $this->passkeyLogin('d-app')->assertOk()->assertJsonPath('data.driver.id', $driver->id);

        $owner->syncRoles([]);
        $this->passkeyLogin('d-app')->assertUnprocessable();
    }
}
