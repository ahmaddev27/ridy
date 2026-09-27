<?php

namespace Tests\Feature;

use App\Domain\Auth\ReviewLogin;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The app-store reviewer sign-in: one configured email + fixed code, off by
 * default, never matching any other account or code.
 */
class AppReviewLoginTest extends TestCase
{
    use RefreshDatabase;

    private const EMAIL = 'reviewer@reidey.test';

    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = Tenant::create([
            'name' => 'Review Fleet', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($tenant->id);
        $this->driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'Reviewer', 'email' => self::EMAIL]);
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'Other', 'email' => 'other@reidey.test']);
    }

    private function verify(string $email, string $otp)
    {
        return $this->postJson('/api/v1/driver/login/verify', ['email' => $email, 'otp' => $otp]);
    }

    public function test_the_fixed_code_does_nothing_while_the_review_sign_in_is_off(): void
    {
        $this->verify(self::EMAIL, '123456')->assertStatus(422);
    }

    public function test_the_configured_email_and_code_sign_the_reviewer_in(): void
    {
        $this->artisan('app-review:login', ['email' => self::EMAIL, 'code' => '123456'])->assertSuccessful();

        $this->verify(strtoupper(self::EMAIL), '123456')
            ->assertOk()
            ->assertJsonStructure(['data' => ['token']]);

        $this->assertNotNull($this->driver->fresh()->activated_at);
    }

    public function test_the_code_never_works_for_another_account_and_a_wrong_code_never_works_for_the_reviewer(): void
    {
        app(ReviewLogin::class)->enable(self::EMAIL, '123456');

        $this->verify('other@reidey.test', '123456')->assertStatus(422);
        $this->verify(self::EMAIL, '654321')->assertStatus(422);
    }

    public function test_turning_it_off_stops_the_fixed_code(): void
    {
        app(ReviewLogin::class)->enable(self::EMAIL, '123456');
        $this->artisan('app-review:login', ['--off' => true])->assertSuccessful();

        $this->verify(self::EMAIL, '123456')->assertStatus(422);
        $this->assertNull(app(ReviewLogin::class)->email());
    }

    public function test_only_a_hash_of_the_code_is_stored(): void
    {
        app(ReviewLogin::class)->enable(self::EMAIL, '123456');

        $stored = Settings::get(ReviewLogin::CODE_HASH_KEY);
        $this->assertNotSame('123456', $stored);
        $this->assertStringStartsWith('$2y$', (string) $stored);
    }
}
