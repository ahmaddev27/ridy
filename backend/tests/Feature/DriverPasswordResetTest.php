<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class DriverPasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private function driver(array $overrides = []): Driver
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        app(TenantContext::class)->set($tenant->id);

        return Driver::create(array_merge([
            'tenant_id' => $tenant->id,
            'name' => 'Basel',
            'uber_driver_uuid' => 'u-1',
            'email' => 'basel@ya.de',
            'password' => Hash::make('oldsecret'),
            'activated_at' => now(),
        ], $overrides));
    }

    public function test_activated_driver_resets_password_with_the_otp(): void
    {
        config(['app.env' => 'testing', 'services.otp_test_code' => '111111']);
        $driver = $this->driver();

        $this->postJson('/api/v1/driver/password/forgot', ['email' => 'basel@ya.de'])
            ->assertOk()->assertJsonPath('data.sent', true);

        $this->postJson('/api/v1/driver/password/reset', [
            'email' => 'basel@ya.de',
            'otp' => '111111',
            'password' => 'newsecret1',
            'password_confirmation' => 'newsecret1',
        ])->assertOk()->assertJsonPath('data.reset', true);

        $this->assertTrue(Hash::check('newsecret1', $driver->fresh()->password));
    }

    public function test_unknown_email_still_returns_ok_without_disclosing(): void
    {
        $this->postJson('/api/v1/driver/password/forgot', ['email' => 'nobody@x.de'])
            ->assertOk()->assertJsonPath('data.sent', true);
    }

    public function test_non_activated_driver_cannot_reset(): void
    {
        config(['app.env' => 'testing', 'services.otp_test_code' => '111111']);
        // A driver who never activated has no OTP issued → reset fails.
        $this->driver(['activated_at' => null, 'password' => null]);

        $this->postJson('/api/v1/driver/password/forgot', ['email' => 'basel@ya.de'])->assertOk();
        $this->postJson('/api/v1/driver/password/reset', [
            'email' => 'basel@ya.de', 'otp' => '111111',
            'password' => 'newsecret1', 'password_confirmation' => 'newsecret1',
        ])->assertStatus(422);
    }
}
