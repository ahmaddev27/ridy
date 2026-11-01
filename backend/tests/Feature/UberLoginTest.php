<?php

namespace Tests\Feature;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Dispatch\LoginAttemptStore;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UberLoginTest extends TestCase
{
    use RefreshDatabase;

    private const CODE = '4821';

    private Tenant $tenant;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.passwordless_login.enabled' => true,
            'services.passwordless_login.tenants' => [],
            'services.uber_auth.url' => 'http://uber-auth.test:8791',
            'services.uber_auth.secret' => 'shh',
        ]);
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('Acme', true);
        $this->manager = $this->makeUser($this->tenant, 'fleet_manager', 'm@acme.de');
        // A previously connected company whose session died: the warm re-auth case.
        SessionBrowser::create(['tenant_id' => $this->tenant->id, 'state' => 'needs_otp', 'last_seen_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);
        Sanctum::actingAs($this->manager);
    }

    private function makeTenant(string $name, bool $flag): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'settings' => $flag ? ['passwordless_login' => ['enabled' => true]] : [],
        ]);
    }

    private function makeUser(Tenant $tenant, string $role, string $email): User
    {
        $user = User::create(['name' => $role, 'email' => $email, 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole($role);

        return $user;
    }

    private function fakeUber(array $start = [], array $mfa = []): void
    {
        Http::fake([
            '*/login/start' => Http::response($start ?: ['status' => 'mfa_required', 'login_id' => 'LID-1', 'channel' => 'unknown']),
            '*/login/mfa' => Http::response($mfa ?: ['status' => 'success', 'persistent' => true]),
            '*/login/cancel' => Http::response(['status' => 'cancelled']),
        ]);
    }

    private function start(): TestResponse
    {
        return $this->postJson('/api/v1/uber-login/start', ['email' => 'ops@acme.de']);
    }

    public function test_every_route_is_a_404_while_the_global_switch_is_off(): void
    {
        config(['services.passwordless_login.enabled' => false]);

        $this->getJson('/api/v1/uber-login/status')->assertNotFound();
        $this->start()->assertNotFound();
        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])->assertNotFound();
        $this->postJson('/api/v1/uber-login/cancel')->assertNotFound();
    }

    public function test_a_company_without_its_own_flag_gets_404(): void
    {
        $other = $this->makeTenant('Closed', false);
        Sanctum::actingAs($this->makeUser($other, 'fleet_manager', 'm@closed.de'));
        Http::fake();

        $this->start()->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_the_rollout_allowlist_excludes_other_companies(): void
    {
        config(['services.passwordless_login.tenants' => ['999999']]);

        $this->start()->assertNotFound();

        config(['services.passwordless_login.tenants' => [(string) $this->tenant->id]]);
        $this->fakeUber();
        $this->start()->assertStatus(202);
    }

    public function test_connections_manage_is_required(): void
    {
        Sanctum::actingAs($this->makeUser($this->tenant, 'viewer', 'v@acme.de'));
        Http::fake();

        $this->start()->assertForbidden();
        $this->getJson('/api/v1/uber-login/status')->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_start_relays_email_and_company_key_with_the_secret_and_hides_the_login_id(): void
    {
        $this->fakeUber();

        $res = $this->start()->assertStatus(202)
            ->assertJsonPath('data.state', 'awaiting_code')
            ->assertJsonMissingPath('data.login_id');
        $this->assertStringNotContainsString('LID-1', $res->getContent());

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/start')
            && $r['email'] === 'ops@acme.de'
            && $r['company_key'] === (string) $this->tenant->id
            && ! isset($r['password'])
            && $r->header('X-Auth-Secret') === ['shh']);
    }

    public function test_the_code_is_relayed_with_the_held_login_id_and_never_persisted(): void
    {
        $this->fakeUber();
        $this->start();
        $this->landCapture();

        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])
            ->assertOk()->assertJsonPath('data.state', 'connected');

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/mfa')
            && $r['login_id'] === 'LID-1' && $r['code'] === self::CODE && $r['company_key'] === (string) $this->tenant->id);

        $cached = json_encode(Cache::get("uber_login:attempt:{$this->tenant->id}"));
        $this->assertStringNotContainsString(self::CODE, $cached);
        $this->assertStringNotContainsString('ops@acme.de', $cached);
        $this->assertStringNotContainsString(self::CODE, AuditLog::all()->toJson());
        $this->assertStringNotContainsString('ops@acme.de', AuditLog::all()->toJson());
        $this->assertGreaterThan(0, AuditLog::where('action', 'uber_login.connected')->count());
    }

    /** The internal capture endpoint stamps this when uber-auth's post is accepted. */
    private function landCapture(): void
    {
        SessionBrowser::where('tenant_id', $this->tenant->id)->update(['last_capture_at' => now()]);
    }

    public function test_connected_is_only_reported_after_a_capture_really_landed(): void
    {
        $this->fakeUber();
        $this->start();

        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])
            ->assertOk()->assertJsonPath('data.state', 'failed')->assertJsonPath('data.failure', 'capture_failed');
        $this->assertSame(0, AuditLog::where('action', 'uber_login.connected')->count());
    }

    public function test_uber_auth_reporting_capture_failed_is_not_connected(): void
    {
        $this->fakeUber(mfa: ['status' => 'capture_failed', 'message' => 'blocked']);
        $this->start();
        $this->landCapture();

        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])
            ->assertOk()->assertJsonPath('data.state', 'failed')->assertJsonPath('data.failure', 'capture_failed');
    }

    public function test_a_start_timeout_is_pending_not_failed_and_never_races(): void
    {
        Http::fake(['*/login/start' => fn () => throw new ConnectionException('cURL error 28: Operation timed out after 90001 milliseconds')]);

        $this->start()->assertOk()
            ->assertJsonPath('data.state', 'starting')->assertJsonPath('data.pending', true)
            ->assertJsonMissingPath('data.failure');
        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.state', 'starting');
    }

    public function test_uber_auth_already_starting_is_pending_too(): void
    {
        $this->fakeUber(start: ['status' => 'start_in_flight']);

        $this->start()->assertOk()->assertJsonPath('data.pending', true)->assertJsonMissingPath('data.failure');
    }

    public function test_a_code_timeout_stays_submitting_and_settles_when_the_capture_lands(): void
    {
        $this->fakeUber();
        $this->start();
        Http::fake(['*/login/mfa' => fn () => throw new ConnectionException('cURL error 28: Operation timed out')]);

        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])->assertOk()
            ->assertJsonPath('data.state', 'submitting')->assertJsonPath('data.pending', true);
        $this->assertStringNotContainsString(self::CODE, json_encode(Cache::get("uber_login:attempt:{$this->tenant->id}")));

        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.state', 'submitting');
        $this->landCapture();
        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.state', 'connected');
    }

    public function test_the_submitting_record_never_outlives_the_login(): void
    {
        $this->fakeUber(mfa: ['status' => 'mfa_required', 'retry' => true]);
        $this->start();
        $this->travel(200)->seconds();

        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])->assertOk();

        // The retry re-put used the REMAINING lifetime (290 - 200 s), not a fresh 290 s.
        $this->travel(80)->seconds(); // 280 s after the start
        $this->assertNotNull(Cache::get("uber_login:attempt:{$this->tenant->id}"));
        $this->travel(15)->seconds(); // 295 s: gone, well before uber-auth's 300 s would matter
        $this->assertNull(Cache::get("uber_login:attempt:{$this->tenant->id}"));
    }

    public function test_the_code_is_never_cached_while_awaiting_or_submitting(): void
    {
        $this->fakeUber(mfa: ['status' => 'mfa_required', 'retry' => true]);
        $this->start();
        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])
            ->assertOk()->assertJsonPath('data.state', 'awaiting_code')->assertJsonPath('data.retry', true);

        $this->assertStringNotContainsString(self::CODE, json_encode(Cache::get("uber_login:attempt:{$this->tenant->id}")));
    }

    public function test_three_wrong_codes_abandon_the_login(): void
    {
        $this->fakeUber(mfa: ['status' => 'mfa_required', 'retry' => true]);
        $this->start();

        $this->postJson('/api/v1/uber-login/code', ['code' => '1111'])->assertOk()->assertJsonPath('data.retry', true);
        $this->postJson('/api/v1/uber-login/code', ['code' => '2222'])->assertOk()->assertJsonPath('data.retry', true);
        $this->postJson('/api/v1/uber-login/code', ['code' => '3333'])
            ->assertOk()->assertJsonPath('data.state', 'failed')->assertJsonPath('data.failure', 'wrong_code');

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/cancel'));
        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.failure', 'wrong_code');
    }

    public function test_an_active_persistent_session_is_never_disturbed(): void
    {
        SessionBrowser::where('tenant_id', $this->tenant->id)->update(['state' => 'active', 'last_seen_at' => now()]);
        Http::fake();

        $this->start()->assertStatus(409)->assertJsonPath('data.failure', 'session_active');
        Http::assertNothingSent();
    }

    public function test_a_never_connected_company_is_sent_to_the_extension_without_touching_uber(): void
    {
        SessionBrowser::where('tenant_id', $this->tenant->id)->delete();
        Http::fake();

        $this->start()->assertStatus(409)->assertJsonPath('data.failure', 'no_session');
        Http::assertNothingSent();
    }

    public function test_a_company_with_a_stored_uber_session_but_no_browser_row_may_start(): void
    {
        SessionBrowser::where('tenant_id', $this->tenant->id)->delete();
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => '7b118561-0f8e-4816-a93f-d6e9c770cfd0',
            'cookies' => [['name' => 'sid', 'value' => 'x']], 'status' => 'expired',
        ]);
        $this->fakeUber();

        $this->start()->assertStatus(202);
    }

    public function test_a_needs_otp_session_may_start(): void
    {
        $this->fakeUber();

        $this->start()->assertStatus(202);
    }

    public function test_an_arkose_challenge_is_surfaced_as_blocked_and_never_retried(): void
    {
        $this->fakeUber(start: ['status' => 'blocked', 'message' => 'arkose']);

        $this->start()->assertOk()->assertJsonPath('data.state', 'failed')->assertJsonPath('data.failure', 'blocked');
        Http::assertSentCount(1);
    }

    public function test_uber_auth_refusals_become_specific_failures(): void
    {
        $this->fakeUber(start: ['status' => 'channel_unavailable']);

        $this->start()->assertOk()->assertJsonPath('data.state', 'failed')->assertJsonPath('data.failure', 'channel_unavailable');
    }

    public function test_an_unreachable_service_is_reported_as_unavailable(): void
    {
        Http::fake(['*' => Http::response('boom', 500)]);

        $this->start()->assertStatus(503)->assertJsonPath('data.failure', 'unavailable');
    }

    public function test_a_second_start_cancels_the_first(): void
    {
        $this->fakeUber();
        $this->start();
        $this->start()->assertStatus(202);

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/cancel') && $r['login_id'] === 'LID-1');
    }

    public function test_companies_cannot_use_each_others_attempt(): void
    {
        $this->fakeUber();
        $this->start();

        $other = $this->makeTenant('Other', true);
        Sanctum::actingAs($this->makeUser($other, 'fleet_manager', 'm@other.de'));

        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.state', 'idle');
        $this->postJson('/api/v1/uber-login/code', ['code' => self::CODE])->assertOk()->assertJsonPath('data.state', 'idle');
        Http::assertNotSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/mfa'));
    }

    public function test_cancel_drops_the_attempt_and_the_browser(): void
    {
        $this->fakeUber();
        $this->start();

        $this->postJson('/api/v1/uber-login/cancel')->assertOk()->assertJsonPath('data.state', 'idle');

        $this->assertNull(app(LoginAttemptStore::class)->get($this->tenant->id));
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/cancel') && $r['login_id'] === 'LID-1');
    }

    public function test_input_is_validated(): void
    {
        Http::fake();

        $this->postJson('/api/v1/uber-login/start', ['email' => 'not-an-email'])->assertUnprocessable();
        $this->postJson('/api/v1/uber-login/code', ['code' => '12ab'])->assertUnprocessable();
        $this->postJson('/api/v1/uber-login/code', ['code' => '123'])->assertUnprocessable();
        $this->postJson('/api/v1/uber-login/code', ['code' => '12345'])->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_the_flag_travels_with_the_session_and_only_a_super_admin_sets_it(): void
    {
        $this->getJson('/api/v1/me')->assertJsonPath('data.tenant.passwordless_login_enabled', true);

        $closed = $this->makeTenant('Closed', false);
        $this->patchJson("/api/v1/admin/companies/{$closed->id}/passwordless-login", ['enabled' => true])->assertForbidden();

        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
        $this->patchJson("/api/v1/admin/companies/{$closed->id}/passwordless-login", ['enabled' => true])
            ->assertOk()->assertJsonPath('data.passwordless_login_enabled', true);
        $this->assertTrue($closed->fresh()->passwordlessLoginEnabled());
    }
}
