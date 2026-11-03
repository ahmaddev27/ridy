<?php

namespace Tests\Feature;

use App\Domain\Auth\Webauthn\CeremonyVerifier;
use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Domain\Auth\Webauthn\PasskeyRegistrar;
use App\Domain\Auth\Webauthn\PasskeyScope;
use App\Domain\Auth\Webauthn\VerifiedRegistration;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Tests\TestCase;

/**
 * App-scoped passkeys for the fleet owner: enrolled from the driver app,
 * signing in to the app only (the same read-only `fleet:read` token the emailed
 * code mints), never the dashboard — and no dashboard passkey ever opens the app.
 */
class FleetOwnerPasskeyTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA Mobility', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function owner(array $overrides = [], string $role = 'fleet_manager'): User
    {
        $user = User::create(array_merge([
            'name' => 'Owner', 'email' => 'owner@ya.de',
            'password' => bcrypt('secret123'), 'tenant_id' => $this->tenant->id,
        ], $overrides));
        $user->assignRole($role);

        return $user;
    }

    private function bindPassingVerifier(string $credentialId = 'owner-new'): void
    {
        $this->app->bind(CeremonyVerifier::class, fn () => new class($credentialId) implements CeremonyVerifier
        {
            public function __construct(private string $credentialId) {}

            public function verifyRegistration(string $optionsJson, array $credential): VerifiedRegistration
            {
                return new VerifiedRegistration(
                    credentialId: $this->credentialId, publicKey: 'key', counter: 0, transports: ['internal'],
                    aaguid: null, userHandle: json_decode($optionsJson, true)['user']['id'],
                    attestationFormat: 'none', origin: 'android:apk-key-hash:test', rpId: 'localhost',
                );
            }

            public function verifyAssertion(string $optionsJson, array $credential, WebauthnCredential $stored): int
            {
                return $stored->counter + 1;
            }
        });
    }

    private function appLogin(string $credentialId): TestResponse
    {
        return $this->postJson('/api/v1/driver/webauthn/login', [
            'ceremony_id' => $this->postJson('/api/v1/driver/webauthn/login/options')->json('ceremony_id'),
            'credential' => ['id' => $credentialId, 'type' => 'public-key'],
        ]);
    }

    /** The ceremony carries user.id base64url-encoded; the stored handle is the plain uuid. */
    private function handleOf(TestResponse $response): string
    {
        return Base64UrlSafe::decodeNoPadding((string) $response->json('options.user.id'));
    }

    private function appCredential(User $owner, string $id = 'owner-app'): WebauthnCredential
    {
        return WebauthnCredential::factory()->app()->for($owner, 'authenticatable')->create(['id' => $id]);
    }

    private function dashboardCredential(User $owner, string $id = 'dash-1'): WebauthnCredential
    {
        return WebauthnCredential::factory()->dashboard()->for($owner, 'authenticatable')->create(['id' => $id]);
    }

    // --- sign-in ---------------------------------------------------------------------

    public function test_an_app_credential_signs_the_owner_in_with_the_read_only_token(): void
    {
        $owner = $this->owner();
        $this->appCredential($owner);
        $this->bindPassingVerifier();

        $response = $this->appLogin('owner-app')->assertOk()->assertJsonPath('data.is_owner', true);

        $this->assertSame(['fleet:read'], $owner->tokens()->sole()->abilities);
        $this->withToken($response->json('data.token'))->getJson('/api/v1/driver/fleet/me')->assertOk();
    }

    public function test_the_app_login_mints_no_dashboard_session(): void
    {
        $this->appCredential($this->owner());
        $this->bindPassingVerifier();

        $this->appLogin('owner-app')->assertOk();

        $this->assertGuest('web');
    }

    public function test_a_dashboard_scoped_user_credential_is_refused_at_the_app(): void
    {
        $this->dashboardCredential($this->owner(), 'owner-dash');
        $this->bindPassingVerifier();

        $this->appLogin('owner-dash')->assertUnprocessable()->assertJsonValidationErrors(['credential']);
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_an_app_scoped_user_credential_is_refused_at_the_dashboard(): void
    {
        $this->appCredential($this->owner());
        $this->bindPassingVerifier();

        $this->postJson('/api/v1/webauthn/login', [
            'ceremony_id' => $this->postJson('/api/v1/webauthn/login/options')->json('ceremony_id'),
            'credential' => ['id' => 'owner-app', 'type' => 'public-key'],
        ])->assertUnprocessable()->assertJsonValidationErrors(['credential']);
        $this->assertGuest('web');
    }

    public function test_a_demoted_owners_credential_is_refused(): void
    {
        $owner = $this->owner();
        $this->appCredential($owner);
        $owner->syncRoles([]);
        $this->bindPassingVerifier();

        $this->appLogin('owner-app')->assertUnprocessable()->assertJsonValidationErrors(['credential']);
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_an_owner_without_a_company_is_refused(): void
    {
        $owner = $this->owner();
        $this->appCredential($owner);
        $owner->forceFill(['tenant_id' => null])->saveQuietly();
        $this->bindPassingVerifier();

        $this->appLogin('owner-app')->assertUnprocessable()->assertJsonValidationErrors(['credential']);
    }

    public function test_the_identity_rule_hands_an_address_a_driver_claimed_first_to_the_driver(): void
    {
        // The driver of the same company activated before the owner existed: the
        // emailed code signs that address in as the driver, so the owner's
        // passkey must not resolve to the owner either.
        $owner = $this->owner();
        $this->appCredential($owner);
        Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'owner@ya.de', 'activated_at' => now()->subYear()]);
        $this->bindPassingVerifier();

        $this->appLogin('owner-app')->assertUnprocessable()->assertJsonValidationErrors(['credential']);
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_a_driver_app_credential_still_signs_the_driver_in(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'omar@ya.de', 'activated_at' => now()->subDay()]);
        WebauthnCredential::factory()->app()->for($driver, 'authenticatable')->create(['id' => 'drv']);
        $this->bindPassingVerifier();

        $this->appLogin('drv')->assertOk()->assertJsonPath('data.is_owner', false);
    }

    public function test_a_suspended_company_blocks_the_owner_passkey_login(): void
    {
        $paused = Tenant::create(['name' => 'Paused GmbH', 'country' => 'DE']);
        $this->appCredential($this->owner(['tenant_id' => $paused->id, 'email' => 'p@paused.de']));
        $this->bindPassingVerifier();

        $this->appLogin('owner-app')->assertForbidden();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    // --- enrolment and management -----------------------------------------------------

    public function test_owner_enrolment_needs_no_password_and_stores_the_app_scope(): void
    {
        $owner = $this->owner();
        Sanctum::actingAs($owner, ['fleet:read']);
        $this->bindPassingVerifier('owner-new');

        $ceremonyId = $this->postJson('/api/v1/driver/fleet/webauthn/register/options')
            ->assertOk()
            ->assertJsonPath('options.user.name', 'owner@ya.de')
            ->json('ceremony_id');

        $this->postJson('/api/v1/driver/fleet/webauthn/register', [
            'ceremony_id' => $ceremonyId, 'alias' => 'Pixel', 'credential' => ['id' => 'owner-new', 'type' => 'public-key'],
        ])->assertCreated();

        $this->assertDatabaseHas('webauthn_credentials', [
            'id' => 'owner-new', 'scope' => 'app', 'authenticatable_type' => User::class, 'authenticatable_id' => $owner->id,
        ]);
    }

    public function test_a_ceremony_started_for_the_app_cannot_be_finished_as_dashboard(): void
    {
        $owner = $this->owner();
        Sanctum::actingAs($owner, ['fleet:read']);
        $this->bindPassingVerifier('owner-new');
        $ceremonyId = $this->postJson('/api/v1/driver/fleet/webauthn/register/options')->json('ceremony_id');

        $this->expectException(ValidationException::class);
        app(PasskeyRegistrar::class)->finish($owner, $ceremonyId, ['id' => 'owner-new'], null, PasskeyScope::Dashboard);
    }

    public function test_listing_and_deleting_see_only_app_rows(): void
    {
        $owner = $this->owner();
        $this->appCredential($owner, 'app-1');
        $this->dashboardCredential($owner);
        Sanctum::actingAs($owner, ['fleet:read']);

        $this->getJson('/api/v1/driver/fleet/webauthn/credentials')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', 'app-1');
        $this->deleteJson('/api/v1/driver/fleet/webauthn/credentials/dash-1')->assertNotFound();
        $this->deleteJson('/api/v1/driver/fleet/webauthn/credentials/app-1')->assertNoContent();
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'dash-1']);
    }

    public function test_the_dashboard_list_and_delete_do_not_see_app_rows(): void
    {
        $owner = $this->owner();
        $this->appCredential($owner, 'app-1');
        $this->dashboardCredential($owner);
        Sanctum::actingAs($owner);

        $this->getJson('/api/v1/webauthn/credentials')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', 'dash-1');
        $this->deleteJson('/api/v1/webauthn/credentials/app-1')->assertNotFound();
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'app-1']);
    }

    public function test_a_user_with_both_scopes_gets_a_different_handle_and_no_cross_exclusion(): void
    {
        $owner = $this->owner();
        $dash = $this->dashboardCredential($owner);
        Sanctum::actingAs($owner, ['fleet:read']);

        $first = $this->postJson('/api/v1/driver/fleet/webauthn/register/options')->assertOk();
        $this->assertNotSame($dash->user_handle, $this->handleOf($first));
        $this->assertSame([], $first->json('options.excludeCredentials') ?? []);

        $app = $this->appCredential($owner, 'app-1');
        $second = $this->postJson('/api/v1/driver/fleet/webauthn/register/options')->assertOk();
        $this->assertSame($app->user_handle, $this->handleOf($second));
        $this->assertCount(1, $second->json('options.excludeCredentials'));
    }

    // --- confinement -------------------------------------------------------------------

    public function test_the_owner_token_stays_out_of_the_dashboard_passkey_routes(): void
    {
        Sanctum::actingAs($this->owner(), ['fleet:read']);

        $this->postJson('/api/v1/webauthn/register/options', ['password' => 'secret123'])->assertForbidden();
        $this->postJson('/api/v1/webauthn/register', [])->assertForbidden();
        $this->deleteJson('/api/v1/webauthn/credentials/x')->assertForbidden();
    }

    public function test_a_driver_token_cannot_reach_the_fleet_passkey_routes(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'omar@ya.de', 'activated_at' => now()]);
        Sanctum::actingAs($driver, ['*'], 'driver');

        $this->assertContains($this->postJson('/api/v1/driver/fleet/webauthn/register/options')->getStatusCode(), [401, 403]);
        $this->assertContains($this->getJson('/api/v1/driver/fleet/webauthn/credentials')->getStatusCode(), [401, 403]);
    }

    public function test_a_user_without_an_owner_role_is_refused_on_the_fleet_routes(): void
    {
        Sanctum::actingAs($this->owner(['email' => 'x@ya.de'], 'viewer'), ['fleet:read']);

        $this->assertContains($this->postJson('/api/v1/driver/fleet/webauthn/register/options')->getStatusCode(), [401, 403]);
    }
}
