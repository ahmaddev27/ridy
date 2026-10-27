<?php

namespace Tests\Feature;

use App\Domain\Auth\Webauthn\CeremonyVerifier;
use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Domain\Auth\Webauthn\VerifiedRegistration;
use App\Domain\Auth\Webauthn\WebauthnVerificationFailed;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

/**
 * Sign-in is username-less by design: the options carry no account hint and the
 * failure answer is one generic message, so the public endpoints cannot be used
 * to probe who exists or who owns a passkey. The cryptographic check itself is
 * the engine's (see WebauthnRegistrationTest header); these tests fake our one
 * verifier seam and exercise the rest for real.
 */
class WebauthnLoginTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $tenantAttributes = []): User
    {
        $tenant = Tenant::create(array_merge(
            ['name' => 'Acme', 'country' => 'DE', 'activated_at' => now()],
            $tenantAttributes,
        ));

        return User::create([
            'name' => 'Anna',
            'email' => 'anna@acme.de',
            'password' => bcrypt('password'),
            'tenant_id' => $tenant->id,
        ]);
    }

    private function bindPassingVerifier(): void
    {
        $this->app->bind(CeremonyVerifier::class, fn () => new class implements CeremonyVerifier
        {
            public function verifyRegistration(string $optionsJson, array $credential): VerifiedRegistration
            {
                throw new \LogicException('not used in this test');
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
                throw new \LogicException('not used in this test');
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
        $ceremonyId = $this->postJson('/api/v1/webauthn/login/options')->json('ceremony_id');

        return [
            'ceremony_id' => $ceremonyId,
            'credential' => ['id' => $credentialId, 'type' => 'public-key'],
        ];
    }

    public function test_login_options_are_public_and_carry_no_account_hint(): void
    {
        $response = $this->postJson('/api/v1/webauthn/login/options')->assertOk();

        $response->assertJsonStructure(['ceremony_id', 'options' => ['challenge', 'rpId']]);
        $this->assertSame([], $response->json('options.allowCredentials') ?? []);
        $this->assertSame('required', $response->json('options.userVerification'));
    }

    public function test_login_signs_the_user_into_the_web_guard_with_remember(): void
    {
        $user = $this->user();
        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'cred-1', 'counter' => 42]);
        $this->bindPassingVerifier();

        // A Referer from the SPA host makes the request stateful (Sanctum SPA
        // pipeline), which is exactly how the dashboard calls this endpoint.
        $csrf = config('sanctum.middleware.validate_csrf_token', ValidateCsrfToken::class);
        $this->withoutMiddleware($csrf);

        $response = $this->withHeader('Referer', 'http://localhost')
            ->postJson('/api/v1/webauthn/login', $this->loginPayload('cred-1'))
            ->assertOk()
            ->assertJsonPath('data.email', 'anna@acme.de');

        $this->assertAuthenticatedAs($user, 'web');

        // D4: a passkey login always remembers the device (no checkbox).
        $rememberCookie = collect($response->baseResponse->headers->getCookies())
            ->first(fn ($cookie) => str_starts_with($cookie->getName(), 'remember_web_'));
        $this->assertNotNull($rememberCookie, 'expected a remember_web_* cookie');

        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'cred-1', 'counter' => 43]);
    }

    public function test_login_fails_generically_for_an_unknown_credential(): void
    {
        $this->bindPassingVerifier();

        $this->postJson('/api/v1/webauthn/login', $this->loginPayload('nobody'))
            ->assertUnprocessable();

        $this->assertGuest('web');
    }

    public function test_login_rejects_a_driver_owned_credential(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'activated_at' => now()]);
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'Driver One']);
        WebauthnCredential::factory()->for($driver, 'authenticatable')->create(['id' => 'driver-cred']);
        $this->bindPassingVerifier();

        // The dashboard login only ever signs in Users; a driver credential gets
        // the same generic refusal as an unknown one.
        $this->postJson('/api/v1/webauthn/login', $this->loginPayload('driver-cred'))
            ->assertUnprocessable();

        $this->assertGuest('web');
    }

    public function test_login_rejects_a_disabled_credential(): void
    {
        $user = $this->user();
        WebauthnCredential::factory()->for($user, 'authenticatable')->create([
            'id' => 'cred-off',
            'disabled_at' => now(),
        ]);
        $this->bindPassingVerifier();

        $this->postJson('/api/v1/webauthn/login', $this->loginPayload('cred-off'))
            ->assertUnprocessable();

        $this->assertGuest('web');
    }

    public function test_login_is_blocked_for_a_suspended_company(): void
    {
        $user = $this->user(['activated_at' => null]);
        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'cred-susp']);
        $this->bindPassingVerifier();

        // Mirrors AuthController::login — a suspended company cannot sign in,
        // whatever the credential. The passkey proves account ownership, so the
        // payment context in the body is as safe to surface as it is there.
        $this->postJson('/api/v1/webauthn/login', $this->loginPayload('cred-susp'))
            ->assertForbidden()
            ->assertJsonPath('message', 'account_suspended');

        $this->assertGuest('web');
    }

    public function test_a_failed_assertion_reads_the_same_as_an_unknown_credential(): void
    {
        $user = $this->user();
        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'cred-bad', 'counter' => 7]);
        $this->bindFailingVerifier();

        $this->postJson('/api/v1/webauthn/login', $this->loginPayload('cred-bad'))
            ->assertUnprocessable();

        $this->assertGuest('web');
        $this->assertDatabaseHas('webauthn_credentials', ['id' => 'cred-bad', 'counter' => 7]);
    }

    public function test_a_ceremony_is_single_use(): void
    {
        $user = $this->user();
        WebauthnCredential::factory()->for($user, 'authenticatable')->create(['id' => 'cred-replay']);
        $this->bindPassingVerifier();

        $payload = $this->loginPayload('cred-replay');

        $this->postJson('/api/v1/webauthn/login', $payload)->assertOk();
        $this->postJson('/api/v1/webauthn/login', $payload)->assertUnprocessable();
    }

    public function test_the_webauthn_rate_limiters_are_registered(): void
    {
        $this->assertNotNull(RateLimiter::limiter('webauthn-options'));
        $this->assertNotNull(RateLimiter::limiter('webauthn-verify'));
    }
}
