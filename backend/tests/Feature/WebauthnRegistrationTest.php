<?php

namespace Tests\Feature;

use App\Domain\Auth\Webauthn\CeremonyVerifier;
use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Domain\Auth\Webauthn\VerifiedRegistration;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The cryptographic ceremony itself (signature + attestation verification) is
 * web-auth/webauthn-lib's job and is covered by that library's own test suite
 * (including its android:apk-key-hash origin cases). These tests bind a fake
 * CeremonyVerifier at our one seam and exercise everything that is OURS for
 * real: routes, guards, throttles, challenge single-use, persistence, scoping.
 */
class WebauthnRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private function actingUser(): User
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'activated_at' => now()]);

        $user = User::create([
            'name' => 'Anna',
            'email' => 'anna@acme.de',
            'password' => bcrypt('password'),
            'tenant_id' => $tenant->id,
        ]);

        Sanctum::actingAs($user);

        return $user;
    }

    private function fakeVerifiedRegistration(string $credentialId = 'cred-id-1'): void
    {
        $this->app->bind(CeremonyVerifier::class, fn () => new class($credentialId) implements CeremonyVerifier
        {
            public function __construct(private string $credentialId) {}

            public function verifyRegistration(string $optionsJson, array $credential): VerifiedRegistration
            {
                return new VerifiedRegistration(
                    credentialId: $this->credentialId,
                    publicKey: 'pem-or-cose-key',
                    counter: 0,
                    transports: ['internal'],
                    aaguid: null,
                    userHandle: 'handle-1',
                    attestationFormat: 'none',
                    origin: 'http://localhost',
                    rpId: 'localhost',
                );
            }

            public function verifyAssertion(string $optionsJson, array $credential, WebauthnCredential $stored): int
            {
                return $stored->counter + 1;
            }
        });
    }

    public function test_register_options_require_authentication(): void
    {
        $this->postJson('/api/v1/webauthn/register/options')->assertUnauthorized();
    }

    public function test_register_options_return_a_resident_key_challenge(): void
    {
        $this->actingUser();

        $response = $this->postJson('/api/v1/webauthn/register/options')->assertOk();

        $response->assertJsonStructure(['ceremony_id', 'options' => ['challenge', 'rp', 'user', 'pubKeyCredParams']]);
        $this->assertSame('localhost', $response->json('options.rp.id'));
        $this->assertSame('required', $response->json('options.authenticatorSelection.residentKey'));
        $this->assertSame('required', $response->json('options.authenticatorSelection.userVerification'));
        $this->assertNotSame('', (string) $response->json('options.challenge'));
    }

    public function test_register_options_exclude_already_registered_credentials(): void
    {
        $user = $this->actingUser();

        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'existing-cred']);

        $this->postJson('/api/v1/webauthn/register/options')
            ->assertOk()
            ->assertJsonPath('options.excludeCredentials.0.id', 'existing-cred');
    }

    public function test_register_persists_a_credential_for_the_user(): void
    {
        $user = $this->actingUser();
        $this->fakeVerifiedRegistration('new-cred');

        $ceremonyId = $this->postJson('/api/v1/webauthn/register/options')->json('ceremony_id');

        $this->postJson('/api/v1/webauthn/register', [
            'ceremony_id' => $ceremonyId,
            'alias' => 'Pixel 8',
            'credential' => ['id' => 'new-cred', 'type' => 'public-key'],
        ])->assertCreated()->assertJsonPath('data.alias', 'Pixel 8');

        $this->assertDatabaseHas('webauthn_credentials', [
            'id' => 'new-cred',
            'authenticatable_type' => User::class,
            'authenticatable_id' => $user->id,
            'alias' => 'Pixel 8',
        ]);
    }

    public function test_register_consumes_the_ceremony_exactly_once(): void
    {
        $this->actingUser();
        $this->fakeVerifiedRegistration('once-cred');

        $ceremonyId = $this->postJson('/api/v1/webauthn/register/options')->json('ceremony_id');
        $payload = ['ceremony_id' => $ceremonyId, 'credential' => ['id' => 'once-cred', 'type' => 'public-key']];

        $this->postJson('/api/v1/webauthn/register', $payload)->assertCreated();

        WebauthnCredential::query()->delete();
        $this->postJson('/api/v1/webauthn/register', $payload)->assertUnprocessable();
    }

    public function test_register_refuses_a_ceremony_started_by_another_account(): void
    {
        $this->actingUser();
        $this->fakeVerifiedRegistration('stolen-cred');

        // Anna starts a ceremony; Omar (same company, his own session) answers it.
        $ceremonyId = $this->postJson('/api/v1/webauthn/register/options')->json('ceremony_id');

        $omar = User::create(['name' => 'Omar', 'email' => 'omar@acme.de', 'password' => bcrypt('x')]);
        Sanctum::actingAs($omar);

        $this->postJson('/api/v1/webauthn/register', [
            'ceremony_id' => $ceremonyId,
            'credential' => ['id' => 'stolen-cred', 'type' => 'public-key'],
        ])->assertUnprocessable()->assertJsonPath('errors.ceremony_id.0', 'ceremony_expired');

        $this->assertDatabaseMissing('webauthn_credentials', ['id' => 'stolen-cred']);
    }

    public function test_register_rejects_a_duplicate_credential_id(): void
    {
        $user = $this->actingUser();
        $this->fakeVerifiedRegistration('dup-cred');

        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'dup-cred']);

        $ceremonyId = $this->postJson('/api/v1/webauthn/register/options')->json('ceremony_id');

        $this->postJson('/api/v1/webauthn/register', [
            'ceremony_id' => $ceremonyId,
            'credential' => ['id' => 'dup-cred', 'type' => 'public-key'],
        ])->assertUnprocessable();
    }

    public function test_credentials_index_lists_only_own_credentials(): void
    {
        $user = $this->actingUser();

        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'mine', 'alias' => 'Mein Gerät']);

        $other = User::create(['name' => 'Omar', 'email' => 'omar@acme.de', 'password' => bcrypt('x')]);
        WebauthnCredential::factory()->for($other, 'authenticatable')->create(['id' => 'theirs']);

        $this->getJson('/api/v1/webauthn/credentials')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', 'mine');
    }

    public function test_credentials_index_never_exposes_the_public_key(): void
    {
        $user = $this->actingUser();

        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'mine']);

        $json = $this->getJson('/api/v1/webauthn/credentials')->assertOk()->json('data.0');

        $this->assertArrayNotHasKey('public_key', $json);
        $this->assertArrayNotHasKey('user_handle', $json);
    }

    public function test_deleting_a_credential_is_scoped_to_the_owner(): void
    {
        $user = $this->actingUser();

        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'mine']);

        $other = User::create(['name' => 'Omar', 'email' => 'omar@acme.de', 'password' => bcrypt('x')]);
        WebauthnCredential::factory()->for($other, 'authenticatable')->create(['id' => 'theirs']);

        // Someone else's credential reads as absent, never as forbidden.
        $this->deleteJson('/api/v1/webauthn/credentials/theirs')->assertNotFound();
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'theirs']);

        $this->deleteJson('/api/v1/webauthn/credentials/mine')->assertNoContent();
        $this->assertDatabaseMissing('webauthn_credentials', ['id' => 'mine']);
    }

    public function test_a_scoped_token_cannot_reach_passkey_management(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'activated_at' => now()]);
        $user = User::create([
            'name' => 'Anna',
            'email' => 'anna@acme.de',
            'password' => bcrypt('password'),
            'tenant_id' => $tenant->id,
        ]);

        // The owner-app token (fleet:read) is confined by dashboard.only.
        Sanctum::actingAs($user, ['fleet:read']);

        $this->postJson('/api/v1/webauthn/register/options')->assertForbidden();
        $this->getJson('/api/v1/webauthn/credentials')->assertForbidden();
    }

    public function test_a_driver_credential_morph_is_storable(): void
    {
        // The table serves both identity models (Phase 2 uses it for drivers).
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'activated_at' => now()]);
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'Driver One']);

        $credential = WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'driver-cred']);

        $this->assertTrue($credential->fresh()->authenticatable->is($driver));
    }
}
