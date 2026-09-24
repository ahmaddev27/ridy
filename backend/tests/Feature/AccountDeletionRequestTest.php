<?php

namespace Tests\Feature;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Fleet\AccountDeletionService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * In-app account deletion request (App Store 5.1.1(v) / Play / DSGVO Art. 17):
 * the phone is cut off at once (sessions + push devices) and an audit entry
 * records the erasure the platform admin must carry out.
 */
class AccountDeletionRequestTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA Mobility', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function driver(): Driver
    {
        return Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'omar@ya.de']);
    }

    private function device(array $attributes): DeviceToken
    {
        return DeviceToken::create(array_merge([
            'tenant_id' => $this->tenant->id, 'platform' => 'android', 'last_used_at' => now(),
        ], $attributes));
    }

    public function test_driver_request_revokes_sessions_and_push_devices_and_is_audited(): void
    {
        $driver = $this->driver();
        $token = $driver->createToken('driver-app')->plainTextToken;
        $driver->createToken('driver-app'); // a second phone
        $this->device(['driver_id' => $driver->id, 'token' => 'fcm-driver-1']);
        $other = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Ali', 'email' => 'ali@ya.de']);
        $this->device(['driver_id' => $other->id, 'token' => 'fcm-other']);

        $this->withToken($token)
            ->postJson('/api/v1/driver/account/deletion-request')
            ->assertStatus(202)
            ->assertJsonPath('data.requested', true);

        $this->assertSame(0, $driver->tokens()->count(), 'every session of the driver is revoked');
        $this->assertFalse(DeviceToken::withoutGlobalScopes()->where('token', 'fcm-driver-1')->exists());
        $this->assertTrue(DeviceToken::withoutGlobalScopes()->where('token', 'fcm-other')->exists(), 'other drivers untouched');
        $this->assertTrue(AuditLog::where('action', AccountDeletionService::ACTION)
            ->where('subject_type', Driver::class)->where('subject_id', $driver->id)
            ->where('tenant_id', $this->tenant->id)->exists());

        // The revoked token no longer opens the app.
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/driver/me')->assertUnauthorized();
    }

    public function test_driver_of_a_suspended_company_can_still_request_deletion(): void
    {
        $driver = $this->driver();
        $token = $driver->createToken('driver-app')->plainTextToken;
        $this->tenant->forceFill(['subscription_ends_at' => now()->subDay()])->save();

        $this->withToken($token)->postJson('/api/v1/driver/account/deletion-request')->assertStatus(202);
        $this->assertSame(0, $driver->tokens()->count());
    }

    public function test_request_requires_authentication(): void
    {
        $this->postJson('/api/v1/driver/account/deletion-request')->assertUnauthorized();
        $this->postJson('/api/v1/driver/fleet/account/deletion-request')->assertUnauthorized();
    }

    public function test_owner_request_revokes_only_the_app_sessions_and_devices(): void
    {
        $owner = User::create([
            'name' => 'Owner', 'email' => 'owner@ya.de',
            'password' => Hash::make('secret123'), 'tenant_id' => $this->tenant->id,
        ]);
        $owner->assignRole('fleet_manager');
        $appToken = $owner->createToken('driver-app-owner', ['fleet:read'])->plainTextToken;
        $owner->createToken('dashboard');
        $this->device(['user_id' => $owner->id, 'token' => 'fcm-owner']);

        $this->withToken($appToken)
            ->postJson('/api/v1/driver/fleet/account/deletion-request')
            ->assertStatus(202);

        $this->assertSame(0, $owner->tokens()->where('name', 'driver-app-owner')->count());
        $this->assertSame(1, $owner->tokens()->where('name', 'dashboard')->count(), 'dashboard access is not cut from a phone');
        $this->assertFalse(DeviceToken::withoutGlobalScopes()->where('token', 'fcm-owner')->exists());
        $this->assertTrue(AuditLog::where('action', AccountDeletionService::ACTION)
            ->where('subject_type', User::class)->where('subject_id', $owner->id)->exists());
    }
}
