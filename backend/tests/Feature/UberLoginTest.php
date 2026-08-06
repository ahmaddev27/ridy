<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UberLoginTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.uber_auth.url' => 'http://uber-auth.test', 'services.uber_auth.secret' => 's']);
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($this->tenant->id);
        $user = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        Sanctum::actingAs($user);
    }

    public function test_direct_success_stores_the_fleet_session(): void
    {
        Http::fake(['*/login/start' => Http::response([
            'status' => 'success',
            'org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc']],
            'expires_at' => now()->addDays(30)->toIso8601String(),
        ])]);

        $this->postJson('/api/v1/uber-login/start', ['email' => 'y@ya.de', 'password' => 'pw'])
            ->assertOk()
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('org_uuid', self::ORG);

        $this->assertSame(self::ORG, $this->tenant->fresh()->uber_org_uuid);
        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->count());
    }

    public function test_mfa_required_is_passed_through_without_storing(): void
    {
        Http::fake(['*/login/start' => Http::response(['status' => 'mfa_required', 'login_id' => 'L1'])]);

        $this->postJson('/api/v1/uber-login/start', ['email' => 'y@ya.de', 'password' => 'pw'])
            ->assertOk()
            ->assertJsonPath('status', 'mfa_required')
            ->assertJsonPath('login_id', 'L1');

        $this->assertSame(0, UberFleetSession::withoutGlobalScopes()->count());
    }

    public function test_mfa_submit_success_stores_the_session(): void
    {
        Http::fake(['*/login/mfa' => Http::response([
            'status' => 'success',
            'org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc']],
        ])]);

        $this->postJson('/api/v1/uber-login/mfa', ['login_id' => 'L1', 'code' => '123456'])
            ->assertOk()
            ->assertJsonPath('status', 'success');

        $this->assertSame(self::ORG, $this->tenant->fresh()->uber_org_uuid);
    }

    public function test_passkey_is_reported_as_unsupported(): void
    {
        Http::fake(['*/login/start' => Http::response(['status' => 'passkey_unsupported'])]);

        $this->postJson('/api/v1/uber-login/start', ['email' => 'y@ya.de', 'password' => 'pw'])
            ->assertOk()
            ->assertJsonPath('status', 'passkey_unsupported');
    }

    public function test_success_without_captured_session_is_an_error(): void
    {
        Http::fake(['*/login/start' => Http::response(['status' => 'success', 'org_uuid' => '', 'cookies' => []])]);

        $this->postJson('/api/v1/uber-login/start', ['email' => 'y@ya.de', 'password' => 'pw'])
            ->assertOk()
            ->assertJsonPath('status', 'error');
    }
}
