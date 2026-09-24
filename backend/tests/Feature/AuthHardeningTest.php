<?php

namespace Tests\Feature;

use App\Domain\Auth\OtpGuard;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\PasswordReset;
use App\Models\Registration;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regression tests for the auth hardening pass: OTP brute force across re-issued
 * codes, account enumeration, single-use codes, sign-up hijack, per-family and
 * per-email rate limits, Cloudflare client IPs, disabled-company activation,
 * profile credential changes and the dispatch-secret allowlist.
 */
class AuthHardeningTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('YA');
        app(TenantContext::class)->set($this->tenant->id);
        // Treat the test host as the dashboard's stateful (cookie-session) origin.
        config(['sanctum.stateful' => ['localhost']]);
    }

    private function makeTenant(string $name, array $overrides = []): Tenant
    {
        return Tenant::create(array_merge([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ], $overrides));
    }

    private function manager(string $email = 'm@ya.de', ?Tenant $tenant = null): User
    {
        $user = User::create([
            'name' => 'Manager', 'email' => $email,
            'password' => Hash::make('secret123'), 'tenant_id' => ($tenant ?? $this->tenant)->id,
        ]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    private function driver(string $email = 'omar@ya.de'): Driver
    {
        return Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => $email, 'activated_at' => now(),
        ]);
    }

    private function pendingCode(string $email, string $otp = '123456'): void
    {
        PasswordReset::updateOrCreate(['email' => $email], [
            'otp' => $otp, 'otp_expires_at' => CarbonImmutable::now()->addMinutes(10), 'attempts' => 0,
        ]);
    }

    // ── OTP ──────────────────────────────────────────────────────────────────

    public function test_a_reissued_code_does_not_reset_the_per_client_failure_budget(): void
    {
        $this->driver();

        for ($i = 0; $i < OtpGuard::MAX_FAILURES_PER_CLIENT; $i++) {
            $this->pendingCode('omar@ya.de'); // a fresh code each round (attempts back to 0)
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
                ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '000000'])
                ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_incorrect');
        }

        // Even the CORRECT code of a brand-new issue is refused for that client…
        $this->pendingCode('omar@ya.de');
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
            ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_too_many');

        // …until the window passes.
        $this->travel(OtpGuard::FAILURE_WINDOW_SECONDS + 1)->seconds();
        $this->pendingCode('omar@ya.de');
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
            ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertOk()->assertJsonStructure(['data' => ['token']]);
    }

    public function test_a_stranger_guessing_from_elsewhere_does_not_lock_the_owner_out(): void
    {
        $this->driver();

        for ($i = 0; $i < OtpGuard::MAX_FAILURES_PER_CLIENT; $i++) {
            $this->pendingCode('omar@ya.de');
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
                ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '000000'])
                ->assertStatus(422);
        }

        $this->pendingCode('omar@ya.de');
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])
            ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertOk()->assertJsonStructure(['data' => ['token']]);
    }

    public function test_verifying_without_a_pending_code_never_counts_against_the_account(): void
    {
        $this->driver();

        for ($i = 0; $i < OtpGuard::MAX_FAILURES_PER_CLIENT * 3; $i++) {
            $this->travel(10)->seconds(); // stay under the per-IP 12/min cap
            $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '000000'])
                ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_incorrect');
        }

        $this->pendingCode('omar@ya.de');
        $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertOk()->assertJsonStructure(['data' => ['token']]);
    }

    public function test_requesting_a_new_code_unlocks_the_requesting_client(): void
    {
        $this->driver();

        for ($i = 0; $i < OtpGuard::MAX_FAILURES_PER_CLIENT; $i++) {
            $this->pendingCode('omar@ya.de');
            $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '000000'])
                ->assertStatus(422);
        }
        $this->pendingCode('omar@ya.de');
        $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_too_many');

        // App 1.0.4's "resend code" is the only way out it knows: it must work.
        $this->postJson('/api/v1/driver/login/request', ['email' => 'omar@ya.de'])->assertOk();
        $code = PasswordReset::where('email', 'omar@ya.de')->value('otp');

        $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => $code])
            ->assertOk()->assertJsonStructure(['data' => ['token']]);
    }

    public function test_the_account_wide_ceiling_stops_a_rotating_ip_pool(): void
    {
        $this->driver();

        for ($i = 0; $i < OtpGuard::MAX_FAILURES_PER_EMAIL; $i++) {
            $this->pendingCode('omar@ya.de');
            $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.'.($i + 1)])
                ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '000000'])
                ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_incorrect');
        }

        // Past the ceiling only the first guess on a freshly issued code gets
        // through (the owner's way back in); further guesses on it are refused.
        $this->pendingCode('omar@ya.de');
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.1.1'])
            ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '000000'])
            ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_incorrect');
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.1.2'])
            ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_too_many');

        $this->pendingCode('omar@ya.de');
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.1.3'])
            ->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertOk()->assertJsonStructure(['data' => ['token']]);
    }

    public function test_a_look_alike_address_never_verifies_against_the_real_code(): void
    {
        // SQLite compares exactly, so hand the guard the row MySQL's accent-
        // insensitive collation would return for "gmäil.com".
        $this->pendingCode('driver@gmail.com');
        $row = PasswordReset::where('email', 'driver@gmail.com')->first();

        try {
            app(OtpGuard::class)->verify($row, 'driver@gmäil.com', '123456');
            $this->fail('A look-alike address must not verify.');
        } catch (ValidationException $e) {
            $this->assertSame('otp_incorrect', $e->errors()['otp'][0]);
        }

        // Nothing was counted, and case differences are still the same address.
        $this->assertSame(0, (int) $row->fresh()->attempts);
        $this->assertSame($row->id, app(OtpGuard::class)->verify($row->fresh(), 'Driver@Gmail.com', '123456')->id);
    }

    public function test_parallel_guesses_cannot_exceed_the_per_code_cap(): void
    {
        $this->pendingCode('omar@ya.de');
        PasswordReset::where('email', 'omar@ya.de')->update(['attempts' => OtpGuard::MAX_ATTEMPTS]);
        // A stale copy read before the other guesses landed still can't guess.
        $stale = PasswordReset::where('email', 'omar@ya.de')->first()->forceFill(['attempts' => 0]);

        $this->expectException(ValidationException::class);
        app(OtpGuard::class)->verify($stale, 'omar@ya.de', '123456');
    }

    public function test_the_per_client_budget_also_covers_the_manager_password_reset(): void
    {
        $this->manager();

        for ($i = 0; $i < OtpGuard::MAX_FAILURES_PER_CLIENT; $i++) {
            $this->pendingCode('m@ya.de');
            $this->postJson('/api/v1/password/verify', ['email' => 'm@ya.de', 'otp' => '000000'])->assertStatus(422);
        }

        $this->pendingCode('m@ya.de');
        $this->postJson('/api/v1/password/reset', [
            'email' => 'm@ya.de', 'otp' => '123456', 'password' => 'newsecret123', 'password_confirmation' => 'newsecret123',
        ])->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_too_many');
    }

    public function test_the_reset_flow_can_verify_then_reset_after_earlier_typos(): void
    {
        $this->manager();
        $this->pendingCode('m@ya.de');

        for ($i = 0; $i < OtpGuard::MAX_ATTEMPTS - 1; $i++) {
            $this->postJson('/api/v1/password/verify', ['email' => 'm@ya.de', 'otp' => '000000'])->assertStatus(422);
        }
        $this->postJson('/api/v1/password/verify', ['email' => 'm@ya.de', 'otp' => '123456'])->assertOk();
        $this->postJson('/api/v1/password/reset', [
            'email' => 'm@ya.de', 'otp' => '123456', 'password' => 'newsecret123', 'password_confirmation' => 'newsecret123',
        ])->assertOk();
    }

    public function test_verify_does_not_reveal_whether_an_account_exists(): void
    {
        $this->driver();
        $this->pendingCode('omar@ya.de');

        $known = $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '000000'])
            ->assertStatus(422)->json('errors.otp.0');
        $unknown = $this->postJson('/api/v1/driver/login/verify', ['email' => 'nobody@nowhere.de', 'otp' => '000000'])
            ->assertStatus(422)->json('errors.otp.0');
        $unknownManager = $this->postJson('/api/v1/password/verify', ['email' => 'nobody@nowhere.de', 'otp' => '000000'])
            ->assertStatus(422)->json('errors.otp.0');

        $this->assertSame('otp_incorrect', $known);
        $this->assertSame($known, $unknown);
        $this->assertSame($known, $unknownManager);
    }

    public function test_a_code_signs_in_only_once(): void
    {
        $this->driver();
        $this->pendingCode('omar@ya.de');

        $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])->assertOk();
        $this->postJson('/api/v1/driver/login/verify', ['email' => 'omar@ya.de', 'otp' => '123456'])
            ->assertStatus(422);

        $this->assertSame(1, Driver::withoutGlobalScopes()->where('email', 'omar@ya.de')->first()->tokens()->count());
    }

    public function test_an_owner_email_squatted_on_another_companys_driver_still_signs_in_as_the_owner(): void
    {
        $owner = $this->manager('owner@ya.de');
        $other = $this->makeTenant('Other');
        Driver::withoutGlobalScopes()->create([
            'tenant_id' => $other->id, 'name' => 'Squatter', 'email' => 'owner@ya.de', 'activated_at' => now(),
        ]);
        $this->pendingCode('owner@ya.de');

        $this->postJson('/api/v1/driver/login/verify', ['email' => 'owner@ya.de', 'otp' => '123456'])
            ->assertOk()
            ->assertJsonPath('data.is_owner', true)
            ->assertJsonPath('data.owner.id', $owner->id);
    }

    public function test_a_driver_who_later_became_another_companys_manager_still_signs_in_as_the_driver(): void
    {
        $other = $this->makeTenant('Other');
        $driver = Driver::withoutGlobalScopes()->create([
            'tenant_id' => $other->id, 'name' => 'Dual', 'email' => 'dual@ya.de', 'activated_at' => now()->subMonth(),
        ]);
        $this->manager('dual@ya.de'); // their own company, created after they started driving
        $this->pendingCode('dual@ya.de');

        $this->postJson('/api/v1/driver/login/verify', ['email' => 'dual@ya.de', 'otp' => '123456'])
            ->assertOk()
            ->assertJsonPath('data.is_owner', false)
            ->assertJsonPath('data.driver.id', $driver->id);
    }

    // ── Sign-up hijack ───────────────────────────────────────────────────────

    public function test_a_signup_overwritten_by_someone_else_is_not_activated_in_the_starting_browser(): void
    {
        $stateful = ['Referer' => 'http://localhost', 'Origin' => 'http://localhost'];

        $this->postJson('/api/v1/register', [
            'company_name' => 'Victim GmbH', 'name' => 'Victim', 'phone' => '+49123',
            'email' => 'victim@acme.de', 'password' => 'victim-secret',
        ], $stateful)->assertOk();

        // An attacker re-submits the form for the same address from elsewhere.
        Registration::where('email', 'victim@acme.de')->update([
            'password' => Hash::make('attacker-secret'), 'otp' => '654321',
        ]);

        $this->postJson('/api/v1/register/verify', ['email' => 'victim@acme.de', 'otp' => '654321'], $stateful)
            ->assertStatus(422)->assertJsonPath('errors.otp.0', 'otp_incorrect');
        $this->assertDatabaseMissing('users', ['email' => 'victim@acme.de']);
    }

    public function test_the_starting_browser_still_completes_its_own_signup(): void
    {
        $stateful = ['Referer' => 'http://localhost', 'Origin' => 'http://localhost'];

        $this->postJson('/api/v1/register', [
            'company_name' => 'Acme', 'name' => 'Alex', 'phone' => '+49123',
            'email' => 'alex@acme.de', 'password' => 'alex-secret',
        ], $stateful)->assertOk();
        $otp = Registration::where('email', 'alex@acme.de')->value('otp');

        $this->postJson('/api/v1/register/verify', ['email' => 'alex@acme.de', 'otp' => $otp], $stateful)->assertOk();
        $this->assertTrue(Hash::check('alex-secret', User::where('email', 'alex@acme.de')->value('password')));
    }

    // ── Rate limits ──────────────────────────────────────────────────────────

    public function test_public_page_loads_no_longer_drain_the_login_budget(): void
    {
        $this->manager();

        for ($i = 0; $i < 8; $i++) {
            $this->getJson('/api/v1/support-contact')->assertOk();
        }

        $this->postJson('/api/v1/login', ['email' => 'm@ya.de', 'password' => 'secret123'])->assertOk();
    }

    public function test_password_guessing_is_capped_per_email_across_ips(): void
    {
        $this->manager();

        // A rotating pool (few guesses per IP) still hits the account-wide ceiling.
        for ($i = 1; $i <= 50; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => '10.1.0.'.$i])
                ->postJson('/api/v1/login', ['email' => 'm@ya.de', 'password' => 'wrong-'.$i])
                ->assertStatus(422);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.1.1.1'])
            ->postJson('/api/v1/login', ['email' => 'm@ya.de', 'password' => 'secret123'])
            ->assertStatus(429);
        // A different account from the same fresh IP is unaffected.
        $this->manager('other@ya.de');
        $this->withServerVariables(['REMOTE_ADDR' => '10.1.1.1'])
            ->postJson('/api/v1/login', ['email' => 'other@ya.de', 'password' => 'secret123'])
            ->assertOk();
    }

    public function test_one_client_guessing_passwords_does_not_lock_the_owner_out(): void
    {
        $this->manager();

        for ($i = 1; $i <= 20; $i++) {
            $this->travel(7)->seconds(); // stay under the per-IP 10/min cap
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
                ->postJson('/api/v1/login', ['email' => 'm@ya.de', 'password' => 'wrong-'.$i])
                ->assertStatus(422);
        }
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
            ->postJson('/api/v1/login', ['email' => 'm@ya.de', 'password' => 'secret123'])
            ->assertStatus(429);

        // The real owner, signing in from their own network, is not affected.
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])
            ->postJson('/api/v1/login', ['email' => 'm@ya.de', 'password' => 'secret123'])
            ->assertOk();
    }

    // ── Cloudflare client IP ─────────────────────────────────────────────────

    public function test_the_visitor_ip_is_taken_from_cloudflare_only_behind_a_cloudflare_edge(): void
    {
        Route::get('/_test/ip', fn (Request $request) => response()->json(['ip' => $request->ip()]));

        // Caddy (trusted hop) forwards a Cloudflare edge as the peer.
        $this->withServerVariables(['REMOTE_ADDR' => '172.18.0.5'])
            ->getJson('/_test/ip', ['X-Forwarded-For' => '162.158.1.10', 'CF-Connecting-IP' => '203.0.113.9'])
            ->assertJsonPath('ip', '203.0.113.9');

        // A direct hit on the origin with a spoofed header is ignored.
        $this->withServerVariables(['REMOTE_ADDR' => '172.18.0.5'])
            ->getJson('/_test/ip', ['X-Forwarded-For' => '198.51.100.7', 'CF-Connecting-IP' => '203.0.113.9'])
            ->assertJsonPath('ip', '198.51.100.7');
    }

    // ── Company activation ───────────────────────────────────────────────────

    public function test_a_disabled_company_cannot_reactivate_itself_with_a_valid_code(): void
    {
        $tenant = $this->makeTenant('Disabled', ['status' => 'disabled']);
        $tenant->forceFill([
            'activation_code' => '123456',
            'activation_code_expires_at' => CarbonImmutable::now()->addMinutes(30),
            'activation_days' => 30,
        ])->save();
        $this->manager('boss@disabled.de', $tenant);

        $this->postJson('/api/v1/company/activate', ['email' => 'boss@disabled.de', 'password' => 'secret123', 'code' => '123456'])
            ->assertStatus(403)->assertJsonPath('reason', 'disabled');

        $this->assertSame('disabled', $tenant->fresh()->status);
    }

    // ── Profile ──────────────────────────────────────────────────────────────

    public function test_a_password_change_revokes_app_tokens_but_keeps_the_extension(): void
    {
        $user = $this->manager();
        $user->createToken('driver-app-owner', ['fleet:read']);
        $user->createToken('ridy-extension', ['fleet-session:write']);

        Sanctum::actingAs($user, ['*']);
        $this->putJson('/api/v1/profile', ['password' => 'brandnew123', 'password_confirmation' => 'brandnew123'])
            ->assertOk();

        $this->assertSame(['ridy-extension'], $user->tokens()->pluck('name')->all());
    }

    public function test_credentials_cannot_be_changed_while_impersonating(): void
    {
        $user = $this->manager();

        $this->actingAs($user, 'web')
            ->withSession(['impersonator_id' => 999])
            ->putJson('/api/v1/profile', ['email' => 'attacker@evil.de'], ['Referer' => 'http://localhost'])
            ->assertForbidden();

        $this->assertSame('m@ya.de', $user->fresh()->email);
    }

    // ── Dispatch secret ──────────────────────────────────────────────────────

    public function test_dispatch_api_honours_the_optional_ip_allowlist_and_logs_rejections(): void
    {
        config(['services.dispatch.ingest_secret' => 'secret', 'services.dispatch.allowed_ips' => ['10.9.0.0/16']]);
        Log::spy();

        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])
            ->getJson('/api/v1/internal/dispatch/sessions', ['X-Dispatch-Secret' => 'secret'])
            ->assertUnauthorized();
        $this->withServerVariables(['REMOTE_ADDR' => '10.9.1.2'])
            ->getJson('/api/v1/internal/dispatch/sessions', ['X-Dispatch-Secret' => 'secret'])
            ->assertOk();

        Log::shouldHaveReceived('warning')->withArgs(fn ($message) => $message === 'dispatch_secret_rejected');
    }
}
