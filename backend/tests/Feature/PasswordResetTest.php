<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\PasswordReset;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);

        return User::create([
            'name' => 'Owner', 'email' => 'owner@acme.de',
            'password' => Hash::make('old-password'), 'tenant_id' => $tenant->id,
        ]);
    }

    public function test_forgot_creates_a_reset_for_a_known_email(): void
    {
        $this->user();

        $this->postJson('/api/v1/password/forgot', ['email' => 'owner@acme.de'])
            ->assertOk()->assertJsonPath('data.sent', true);

        $reset = PasswordReset::where('email', 'owner@acme.de')->firstOrFail();
        $this->assertMatchesRegularExpression('/^\d{6}$/', $reset->otp);
    }

    public function test_forgot_does_not_reveal_unknown_emails(): void
    {
        $this->postJson('/api/v1/password/forgot', ['email' => 'nobody@acme.de'])
            ->assertOk()->assertJsonPath('data.sent', true);

        $this->assertDatabaseCount('password_resets', 0);
    }

    public function test_reset_changes_the_password_with_a_valid_code(): void
    {
        $user = $this->user();
        PasswordReset::create([
            'email' => $user->email, 'otp' => '123456',
            'otp_expires_at' => CarbonImmutable::now()->addMinutes(10), 'attempts' => 0,
        ]);

        $this->postJson('/api/v1/password/reset', [
            'email' => $user->email, 'otp' => '123456',
            'password' => 'brand-new-password', 'password_confirmation' => 'brand-new-password',
        ])->assertOk()->assertJsonPath('data.reset', true);

        $this->assertTrue(Hash::check('brand-new-password', $user->fresh()->password));
        $this->assertDatabaseCount('password_resets', 0);
    }

    public function test_verify_accepts_a_valid_code_without_consuming_it(): void
    {
        $user = $this->user();
        PasswordReset::create([
            'email' => $user->email, 'otp' => '123456',
            'otp_expires_at' => CarbonImmutable::now()->addMinutes(10), 'attempts' => 0,
        ]);

        $this->postJson('/api/v1/password/verify', ['email' => $user->email, 'otp' => '123456'])
            ->assertOk()->assertJsonPath('data.verified', true);

        // Still pending — verify does not consume the code.
        $this->assertDatabaseCount('password_resets', 1);
    }

    public function test_reset_rejects_mismatched_confirmation(): void
    {
        $user = $this->user();
        PasswordReset::create([
            'email' => $user->email, 'otp' => '123456',
            'otp_expires_at' => CarbonImmutable::now()->addMinutes(10), 'attempts' => 0,
        ]);

        $this->postJson('/api/v1/password/reset', [
            'email' => $user->email, 'otp' => '123456',
            'password' => 'brand-new-password', 'password_confirmation' => 'different',
        ])->assertStatus(422)->assertJsonValidationErrors('password');
    }

    public function test_reset_rejects_a_wrong_code_and_counts_the_attempt(): void
    {
        $user = $this->user();
        PasswordReset::create([
            'email' => $user->email, 'otp' => '123456',
            'otp_expires_at' => CarbonImmutable::now()->addMinutes(10), 'attempts' => 0,
        ]);

        $this->postJson('/api/v1/password/reset', [
            'email' => $user->email, 'otp' => '000000',
            'password' => 'brand-new-password', 'password_confirmation' => 'brand-new-password',
        ])->assertStatus(422);

        $this->assertSame(1, PasswordReset::where('email', $user->email)->value('attempts'));
        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));
    }

    public function test_reset_requires_a_six_digit_code(): void
    {
        $user = $this->user();

        $this->postJson('/api/v1/password/reset', [
            'email' => $user->email, 'otp' => '123', 'password' => 'brand-new-password',
        ])->assertStatus(422)->assertJsonValidationErrors('otp');
    }
}
