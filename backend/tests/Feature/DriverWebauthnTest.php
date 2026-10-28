<?php

namespace Tests\Feature;

use App\Domain\Auth\Webauthn\CeremonyVerifier;
use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Domain\Auth\Webauthn\VerifiedRegistration;
use App\Domain\Auth\Webauthn\WebauthnVerificationFailed;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The driver app's passkeys (docs/22 §4.6): the dashboard layer reused
 * verbatim behind the driver guard. As in WebauthnLoginTest, the ceremony
 * itself is the engine's business and sits behind a faked CeremonyVerifier;
 * everything OURS — routes, guards, gates, token shape, scoping, the one
 * generic refusal — runs for real.
 */
class DriverWebauthnTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'YA Mobility', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    private function driver(array $overrides = []): Driver
    {
        return Driver::create(array_merge([
            'tenant_id' => $this->tenant->id,
            'name' => 'Omar',
            'email' => 'omar@ya.de',
            'activated_at' => now()->subDay(),
        ], $overrides));
    }

    private function suspendedTenant(): Tenant
    {
        // Never activated, no subscription: stateReason() = 'inactive'.
        return Tenant::create(['name' => 'Paused GmbH', 'country' => 'DE']);
    }

    /** A verifier that accepts every ceremony: registrations yield $credentialId, assertions bump the counter. */
    private function bindPassingVerifier(string $credentialId = 'new-cred'): void
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
                    userHandle: json_decode($optionsJson, true)['user']['id'] ?? 'handle',
                    attestationFormat: 'none',
                    origin: 'android:apk-key-hash:test',
                    rpId: 'localhost',
                );
            }

            public function verifyAssertion(string $optionsJson, array $credential, WebauthnCredential $stored): int
            {
                return $stored->counter + 1;
            }
        });
    }

    private function bindFailingVerifier(): void
    {
        $this->app->bind(CeremonyVerifier::class, fn () => new class implements CeremonyVerifier
        {
            public function verifyRegistration(string $optionsJson, array $credential): VerifiedRegistration
            {
                throw new WebauthnVerificationFailed('attestation failed');
            }

            public function verifyAssertion(string $optionsJson, array $credential, WebauthnCredential $stored): int
            {
                throw new WebauthnVerificationFailed('assertion failed');
            }
        });
    }

    /** @return array{ceremony_id: string, credential: array{id: string, type: string}} */
    private function loginPayload(string $credentialId): array
    {
        $ceremonyId = $this->postJson('/api/v1/driver/webauthn/login/options')->json('ceremony_id');

        return [
            'ceremony_id' => $ceremonyId,
            'credential' => ['id' => $credentialId, 'type' => 'public-key'],
        ];
    }

    // --- sign-in (public) ------------------------------------------------------------

    public function test_login_options_are_public_and_carry_no_account_hint(): void
    {
        $response = $this->postJson('/api/v1/driver/webauthn/login/options')->assertOk();

        $response->assertJsonStructure(['ceremony_id', 'options' => ['challenge', 'rpId']]);
        $this->assertSame('localhost', $response->json('options.rpId'));
        $this->assertSame([], $response->json('options.allowCredentials') ?? []);
        $this->assertSame('required', $response->json('options.userVerification'));
    }

    public function test_login_mints_the_app_token_in_the_code_verify_shape(): void
    {
        $driver = $this->driver();
        WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'cred-1', 'counter' => 42]);
        $this->bindPassingVerifier();

        $response = $this->postJson('/api/v1/driver/webauthn/login', $this->loginPayload('cred-1'))
            ->assertOk()
            ->assertJsonStructure(['data' => ['token', 'is_owner', 'driver' => ['id', 'name', 'company_name']]])
            ->assertJsonPath('data.is_owner', false)
            ->assertJsonPath('data.driver.id', $driver->id);

        // The same tail as loginVerify: the token is a live driver-app session.
        $this->withToken($response->json('data.token'))
            ->getJson('/api/v1/driver/me')
            ->assertOk()
            ->assertJsonPath('data.id', $driver->id);

        $this->assertNotNull($driver->fresh()->last_login_at);
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'cred-1', 'counter' => 43]);
    }

    public function test_login_fails_generically_for_an_unknown_credential(): void
    {
        $this->bindPassingVerifier();

        $this->postJson('/api/v1/driver/webauthn/login', $this->loginPayload('nobody'))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['credential']);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_rejects_a_dashboard_users_credential(): void
    {
        $user = User::create(['name' => 'Anna', 'email' => 'anna@ya.de', 'password' => bcrypt('x'), 'tenant_id' => $this->tenant->id]);
        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'manager-cred']);
        $this->bindPassingVerifier();

        // The app login only ever signs in Drivers; owner mode keeps its emailed
        // code, and a manager's passkey gets the same refusal as an unknown one.
        $this->postJson('/api/v1/driver/webauthn/login', $this->loginPayload('manager-cred'))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['credential']);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_rejects_a_disabled_credential(): void
    {
        $driver = $this->driver();
        WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'cred-off', 'disabled_at' => now()]);
        $this->bindPassingVerifier();

        $this->postJson('/api/v1/driver/webauthn/login', $this->loginPayload('cred-off'))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['credential']);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_is_blocked_for_a_suspended_company(): void
    {
        $driver = $this->driver(['tenant_id' => $this->suspendedTenant()->id]);
        WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'cred-susp', 'counter' => 3]);
        $this->bindPassingVerifier();

        // Mirrors loginVerify's gate, in the app's own suspended shape (no
        // payment reference — that belongs to the dashboard's).
        $this->postJson('/api/v1/driver/webauthn/login', $this->loginPayload('cred-susp'))
            ->assertForbidden()
            ->assertJsonPath('message', 'account_suspended')
            ->assertJsonPath('reason', 'inactive')
            ->assertJsonMissingPath('payment_reference');

        $this->assertDatabaseCount('personal_access_tokens', 0);
        // The assertion was valid regardless; the counter moves so the next
        // sign-in does not read the authenticator as a clone.
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'cred-susp', 'counter' => 4]);
    }

    public function test_a_failed_assertion_reads_the_same_as_an_unknown_credential(): void
    {
        $driver = $this->driver();
        WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'cred-bad', 'counter' => 7]);
        $this->bindFailingVerifier();

        $this->postJson('/api/v1/driver/webauthn/login', $this->loginPayload('cred-bad'))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['credential']);

        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'cred-bad', 'counter' => 7]);
    }

    public function test_a_ceremony_is_single_use(): void
    {
        $driver = $this->driver();
        WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'cred-replay']);
        $this->bindPassingVerifier();

        $payload = $this->loginPayload('cred-replay');

        $this->postJson('/api/v1/driver/webauthn/login', $payload)->assertOk();
        $this->postJson('/api/v1/driver/webauthn/login', $payload)
            ->assertUnprocessable()
            ->assertJsonPath('errors.ceremony_id.0', 'ceremony_expired');

        $this->assertDatabaseCount('personal_access_tokens', 1);
    }

    public function test_the_app_rides_the_dashboards_named_limiters(): void
    {
        $this->assertNotNull(RateLimiter::limiter('webauthn-options'));
        $this->assertNotNull(RateLimiter::limiter('webauthn-verify'));
    }

    // --- enrolment and management (driver guard) -----------------------------------------

    public function test_enrolment_requires_a_driver_session(): void
    {
        $this->postJson('/api/v1/driver/webauthn/register/options')->assertUnauthorized();
        $this->getJson('/api/v1/driver/webauthn/credentials')->assertUnauthorized();

        // A dashboard manager's session is not a driver session.
        $user = User::create(['name' => 'Anna', 'email' => 'anna@ya.de', 'password' => bcrypt('x'), 'tenant_id' => $this->tenant->id]);
        Sanctum::actingAs($user);

        $this->postJson('/api/v1/driver/webauthn/register/options')->assertUnauthorized();
    }

    public function test_enrolment_needs_no_password_and_names_the_driver(): void
    {
        $driver = $this->driver();
        Sanctum::actingAs($driver, guard: 'driver');

        // No body at all: a driver has no password to step up with.
        $response = $this->postJson('/api/v1/driver/webauthn/register/options')->assertOk();

        $response->assertJsonStructure(['ceremony_id', 'options' => ['challenge', 'rp', 'user', 'pubKeyCredParams']]);
        $this->assertSame('localhost', $response->json('options.rp.id'));
        $this->assertSame('omar@ya.de', $response->json('options.user.name'));
        $this->assertSame('Omar', $response->json('options.user.displayName'));
        $this->assertSame('required', $response->json('options.authenticatorSelection.residentKey'));
        $this->assertSame('required', $response->json('options.authenticatorSelection.userVerification'));
    }

    public function test_enrolment_falls_back_to_the_uber_address_when_the_driver_has_none(): void
    {
        $driver = $this->driver(['email' => null, 'uber_email' => 'omar.uber@ya.de']);
        Sanctum::actingAs($driver, guard: 'driver');

        $this->postJson('/api/v1/driver/webauthn/register/options')
            ->assertOk()
            ->assertJsonPath('options.user.name', 'omar.uber@ya.de');
    }

    public function test_register_persists_a_driver_credential(): void
    {
        $driver = $this->driver();
        Sanctum::actingAs($driver, guard: 'driver');
        $this->bindPassingVerifier('driver-cred');

        $ceremonyId = $this->postJson('/api/v1/driver/webauthn/register/options')->json('ceremony_id');

        $this->postJson('/api/v1/driver/webauthn/register', [
            'ceremony_id' => $ceremonyId,
            'alias' => 'Pixel 8',
            'credential' => ['id' => 'driver-cred', 'type' => 'public-key'],
        ])->assertCreated()->assertJsonPath('data.alias', 'Pixel 8')->assertJsonPath('data.id', 'driver-cred');

        $this->assertDatabaseHas('webauthn_credentials', [
            'id' => 'driver-cred',
            'authenticatable_type' => Driver::class,
            'authenticatable_id' => $driver->id,
            'origin' => 'android:apk-key-hash:test',
        ]);
    }

    public function test_a_ceremony_started_by_one_driver_cannot_be_finished_by_another(): void
    {
        $anna = $this->driver(['name' => 'Anna', 'email' => 'anna@ya.de']);
        Sanctum::actingAs($anna, guard: 'driver');
        $ceremonyId = $this->postJson('/api/v1/driver/webauthn/register/options')->json('ceremony_id');

        $omar = $this->driver();
        Sanctum::actingAs($omar, guard: 'driver');
        $this->bindPassingVerifier('stolen-cred');

        $this->postJson('/api/v1/driver/webauthn/register', [
            'ceremony_id' => $ceremonyId,
            'credential' => ['id' => 'stolen-cred', 'type' => 'public-key'],
        ])->assertUnprocessable()->assertJsonPath('errors.ceremony_id.0', 'ceremony_expired');

        $this->assertDatabaseMissing('webauthn_credentials', ['id' => 'stolen-cred']);
    }

    public function test_credentials_index_and_delete_are_scoped_to_the_driver(): void
    {
        $mine = $this->driver();
        WebauthnCredential::factory()->for($mine, 'authenticatable')->create(['id' => 'mine', 'alias' => 'Mein Handy']);

        $other = $this->driver(['name' => 'Sami', 'email' => 'sami@ya.de']);
        WebauthnCredential::factory()->for($other, 'authenticatable')->create(['id' => 'theirs']);

        // A dashboard user's row with a colliding owner id must never surface either.
        $user = User::create(['name' => 'Anna', 'email' => 'anna@ya.de', 'password' => bcrypt('x'), 'tenant_id' => $this->tenant->id]);
        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'managers']);

        Sanctum::actingAs($mine, guard: 'driver');

        $json = $this->getJson('/api/v1/driver/webauthn/credentials')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', 'mine')
            ->assertJsonPath('data.0.alias', 'Mein Handy')
            ->json('data.0');
        $this->assertArrayHasKey('created_at', $json);
        $this->assertArrayNotHasKey('public_key', $json);
        $this->assertArrayNotHasKey('user_handle', $json);

        $this->deleteJson('/api/v1/driver/webauthn/credentials/theirs')->assertNotFound();
        $this->deleteJson('/api/v1/driver/webauthn/credentials/managers')->assertNotFound();
        $this->deleteJson('/api/v1/driver/webauthn/credentials/mine')->assertNoContent();

        $this->assertDatabaseMissing('webauthn_credentials', ['id' => 'mine']);
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'theirs']);
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'managers']);
    }

    public function test_management_is_blocked_for_a_suspended_company(): void
    {
        $driver = $this->driver(['tenant_id' => $this->suspendedTenant()->id]);
        WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'mine']);
        Sanctum::actingAs($driver, guard: 'driver');

        // `driver.active`, like every other app route: the company lapsed, the app stops.
        $this->postJson('/api/v1/driver/webauthn/register/options')
            ->assertForbidden()->assertJsonPath('message', 'account_suspended');
        $this->getJson('/api/v1/driver/webauthn/credentials')
            ->assertForbidden()->assertJsonPath('message', 'account_suspended');
        $this->deleteJson('/api/v1/driver/webauthn/credentials/mine')
            ->assertForbidden()->assertJsonPath('message', 'account_suspended');

        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'mine']);
    }
}
