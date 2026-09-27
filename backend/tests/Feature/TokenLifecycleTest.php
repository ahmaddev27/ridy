<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * Sanctum tokens: idle (sliding) expiry instead of an absolute lifetime, and a
 * throttled last_used_at write instead of one UPDATE per driver-app poll.
 */
class TokenLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($tenant->id);
        $this->driver = Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'Omar', 'email' => 'omar@ya.de', 'activated_at' => now(),
        ]);
    }

    private function tokenRow(string $plain): PersonalAccessToken
    {
        return PersonalAccessToken::findToken($plain);
    }

    public function test_a_token_used_recently_keeps_working(): void
    {
        $plain = $this->driver->createToken('driver-app')->plainTextToken;
        $this->tokenRow($plain)->forceFill(['last_used_at' => now()->subDays(80)])->save();

        $this->getJson('/api/v1/driver/me', ['Authorization' => 'Bearer '.$plain])->assertOk();
    }

    public function test_a_token_idle_past_the_window_is_rejected(): void
    {
        config()->set('sanctum.idle_expiration_days', 90);
        $plain = $this->driver->createToken('driver-app')->plainTextToken;
        $this->tokenRow($plain)->forceFill(['last_used_at' => now()->subDays(91)])->save();

        $this->getJson('/api/v1/driver/me', ['Authorization' => 'Bearer '.$plain])->assertUnauthorized();
    }

    public function test_a_never_used_token_expires_from_its_creation_date(): void
    {
        config()->set('sanctum.idle_expiration_days', 90);
        $plain = $this->driver->createToken('driver-app')->plainTextToken;
        $this->tokenRow($plain)->forceFill(['created_at' => now()->subDays(100), 'last_used_at' => null])->save();

        $this->getJson('/api/v1/driver/me', ['Authorization' => 'Bearer '.$plain])->assertUnauthorized();
    }

    public function test_last_used_at_is_written_at_most_once_per_interval(): void
    {
        $plain = $this->driver->createToken('driver-app')->plainTextToken;
        $auth = ['Authorization' => 'Bearer '.$plain];

        $this->getJson('/api/v1/driver/me', $auth)->assertOk();
        $first = $this->tokenRow($plain)->last_used_at;
        $this->assertNotNull($first);

        $this->travel(2)->minutes();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/driver/me', $auth)->assertOk();
        $this->assertTrue($first->equalTo($this->tokenRow($plain)->last_used_at), 'refreshed inside the interval');

        $this->travel(15)->minutes();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/driver/me', $auth)->assertOk();
        $this->assertTrue($this->tokenRow($plain)->last_used_at->gt($first), 'not refreshed after the interval');
    }
}
