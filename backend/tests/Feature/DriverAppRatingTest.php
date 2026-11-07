<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\AppRating;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DriverAppRatingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = $this->makeTenant('YA Mobility');
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function makeTenant(string $name): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    private function tokenFor(Tenant $tenant, string $email): array
    {
        $driver = Driver::withoutGlobalScopes()->create(['tenant_id' => $tenant->id, 'name' => 'D', 'email' => $email]);

        return [$driver, $driver->createToken('driver-app')->plainTextToken];
    }

    public function test_valid_rating_is_saved_with_token_tenant_and_driver(): void
    {
        [$driver, $token] = $this->tokenFor($this->tenant, 'a@ya.de');

        $this->withToken($token)->postJson('/api/v1/driver/app-rating', [
            'stars' => 2, 'feedback' => ' Too slow ', 'platform' => 'ios', 'app_version' => '1.1.3',
            'tenant_id' => 999, 'driver_id' => 999,
        ])->assertOk()->assertJsonPath('data.saved', true);

        $row = AppRating::withoutGlobalScopes()->sole();
        $this->assertSame($this->tenant->id, $row->tenant_id);
        $this->assertSame($driver->id, $row->driver_id);
        $this->assertSame(2, $row->stars);
        $this->assertSame('Too slow', $row->feedback);
        $this->assertSame('ios', $row->platform);
    }

    public function test_feedback_is_optional_and_resubmit_replaces_the_row(): void
    {
        [, $token] = $this->tokenFor($this->tenant, 'a@ya.de');

        $this->withToken($token)->postJson('/api/v1/driver/app-rating', ['stars' => 3, 'feedback' => 'meh', 'platform' => 'android'])->assertOk();
        $this->withToken($token)->postJson('/api/v1/driver/app-rating', ['stars' => 5, 'platform' => 'android'])->assertOk();

        $row = AppRating::withoutGlobalScopes()->sole();
        $this->assertSame(5, $row->stars);
        $this->assertNull($row->feedback);
    }

    public function test_invalid_input_is_rejected(): void
    {
        [, $token] = $this->tokenFor($this->tenant, 'a@ya.de');

        $bodies = [
            ['stars' => 0, 'platform' => 'ios'],
            ['stars' => 6, 'platform' => 'ios'],
            ['stars' => 'x', 'platform' => 'ios'],
            ['platform' => 'ios'],
            ['stars' => 4, 'platform' => 'web'],
            ['stars' => 4, 'platform' => 'ios', 'feedback' => str_repeat('a', 1001)],
        ];
        foreach ($bodies as $body) {
            $this->withToken($token)->postJson('/api/v1/driver/app-rating', $body)->assertUnprocessable();
        }
        $this->assertSame(0, AppRating::withoutGlobalScopes()->count());
    }

    public function test_requires_driver_auth_and_isolates_tenants(): void
    {
        $this->postJson('/api/v1/driver/app-rating', ['stars' => 5, 'platform' => 'ios'])->assertUnauthorized();
        $this->app['auth']->forgetGuards();

        $other = $this->makeTenant('Other');
        [$d1, $t1] = $this->tokenFor($this->tenant, 'a@ya.de');
        [$d2, $t2] = $this->tokenFor($other, 'b@o.de');
        $this->withToken($t1)->postJson('/api/v1/driver/app-rating', ['stars' => 5, 'platform' => 'ios'])->assertOk();
        $this->app['auth']->forgetGuards();
        app(TenantContext::class)->set($other->id);
        $this->withToken($t2)->postJson('/api/v1/driver/app-rating', ['stars' => 1, 'platform' => 'android'])->assertOk();

        $this->assertSame($other->id, AppRating::withoutGlobalScopes()->where('driver_id', $d2->id)->value('tenant_id'));
        $this->assertSame($this->tenant->id, AppRating::withoutGlobalScopes()->where('driver_id', $d1->id)->value('tenant_id'));
    }
}
