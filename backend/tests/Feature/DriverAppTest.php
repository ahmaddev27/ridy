<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DriverAppTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->tenant = Tenant::create([
            'name' => 'YA Mobility', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function driver(array $overrides = []): Driver
    {
        return Driver::create(array_merge([
            'tenant_id' => $this->tenant->id,
            'name' => 'Omar',
            'email' => 'omar@ya.de',
        ], $overrides));
    }

    public function test_manager_invite_sets_token_and_emails_activation_link(): void
    {
        $driver = $this->driver();

        $this->invitationService()->invite($driver);

        $driver->refresh();
        $this->assertNotNull($driver->invite_token);
        $this->assertNotNull($driver->invited_at);
        $this->assertSame('invited', $driver->appStatus());
    }

    public function test_activate_consumes_token_and_returns_bearer_token(): void
    {
        $driver = $this->driver();
        $this->invitationService()->invite($driver);
        $token = $driver->fresh()->invite_token;

        $res = $this->postJson('/api/v1/driver/activate', [
            'token' => $token,
            'password' => 'secret123',
        ])->assertOk();

        $this->assertNotEmpty($res->json('data.token'));
        $driver->refresh();
        $this->assertNull($driver->invite_token, 'token is consumed');
        $this->assertNotNull($driver->activated_at);
        $this->assertTrue(Hash::check('secret123', $driver->password));
    }

    public function test_activate_with_unknown_token_is_rejected(): void
    {
        $this->postJson('/api/v1/driver/activate', [
            'token' => 'nope',
            'password' => 'secret123',
        ])->assertNotFound();
    }

    public function test_login_requires_activation_and_correct_password(): void
    {
        $driver = $this->driver(['password' => Hash::make('secret123'), 'activated_at' => now()]);

        $this->postJson('/api/v1/driver/login', ['email' => $driver->email, 'password' => 'wrong'])
            ->assertStatus(422);

        $this->postJson('/api/v1/driver/login', ['email' => $driver->email, 'password' => 'secret123'])
            ->assertOk()
            ->assertJsonStructure(['data' => ['token', 'driver' => ['id', 'name', 'company_name']]]);
    }

    public function test_unactivated_driver_cannot_login(): void
    {
        $driver = $this->driver(['password' => Hash::make('secret123')]); // no activated_at

        $this->postJson('/api/v1/driver/login', ['email' => $driver->email, 'password' => 'secret123'])
            ->assertStatus(422);
    }

    public function test_driver_registers_device_token_under_its_own_identity(): void
    {
        $driver = $this->driver(['activated_at' => now()]);
        Sanctum::actingAs($driver, guard: 'driver');

        $this->postJson('/api/v1/driver/devices', ['token' => 'fcm-abc', 'platform' => 'android'])
            ->assertCreated();

        $this->assertDatabaseHas('device_tokens', [
            'token' => 'fcm-abc', 'driver_id' => $driver->id, 'tenant_id' => $this->tenant->id,
        ]);
    }

    public function test_driver_updates_profile_name_locale_and_password(): void
    {
        $driver = $this->driver(['activated_at' => now(), 'locale' => 'de']);
        Sanctum::actingAs($driver, guard: 'driver');

        $this->patchJson('/api/v1/driver/me', [
            'name' => 'Omar Updated',
            'locale' => 'ar',
            'password' => 'newsecret123',
        ])->assertOk()->assertJsonPath('data.locale', 'ar')->assertJsonPath('data.name', 'Omar Updated');

        $driver->refresh();
        $this->assertSame('ar', $driver->locale);
        $this->assertTrue(Hash::check('newsecret123', $driver->password));
    }

    public function test_driver_offers_feed_returns_only_own_offers(): void
    {
        $mine = $this->driver(['activated_at' => now()]);
        $other = $this->driver(['email' => 'x@ya.de']);

        $this->offer($mine, 'off-1');
        $this->offer($other, 'off-2');

        Sanctum::actingAs($mine, guard: 'driver');
        $res = $this->getJson('/api/v1/driver/offers')->assertOk();

        $this->assertCount(1, $res->json('data'));
    }

    private function offer(Driver $driver, string $uuid): DispatchOffer
    {
        return DispatchOffer::create([
            'tenant_id' => $driver->tenant_id,
            'driver_id' => $driver->id,
            'driver_uuid' => 'uuid-'.$driver->id,
            'offer_uuid' => $uuid,
            'received_at' => now(),
            'raw_payload' => [],
            'status' => OfferStatus::Pending,
        ]);
    }

    private function invitationService(): DriverInvitationService
    {
        return app(DriverInvitationService::class);
    }
}
