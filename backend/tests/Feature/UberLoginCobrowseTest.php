<?php

namespace Tests\Feature;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Dispatch\CobrowseTicketSigner;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\PasswordlessLoginService;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class UberLoginCobrowseTest extends TestCase
{
    use RefreshDatabase;

    private const LOGIN_ID = 'LID-SECRET-77';

    private Tenant $tenant;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.passwordless_login.enabled' => true,
            'services.passwordless_login.tenants' => [],
            'services.passwordless_login.cobrowse' => true,
            'services.passwordless_login.cobrowse_ws_url' => 'wss://reidey.test/cobrowse/ws',
            'services.uber_auth.url' => 'http://uber-auth.test:8791',
            'services.uber_auth.secret' => 'shh',
        ]);
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('Acme', true);
        $this->manager = $this->makeUser($this->tenant, 'fleet_manager', 'm@acme.de');
        SessionBrowser::create(['tenant_id' => $this->tenant->id, 'state' => 'needs_otp', 'last_seen_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);
        Sanctum::actingAs($this->manager);
        Cache::flush();
        RateLimiter::clear('uber-login-cobrowse:'.$this->tenant->id);
    }

    private function makeTenant(string $name, bool $cobrowse): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'proxy_url' => 'http://u:p@proxy.test:8000',
            'settings' => ['passwordless_login' => ['enabled' => true, 'cobrowse' => $cobrowse]],
        ]);
    }

    private function makeUser(Tenant $tenant, string $role, string $email): User
    {
        $user = User::create(['name' => $role, 'email' => $email, 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole($role);

        return $user;
    }

    /** @param  array<string, mixed>  $resume */
    private function fakeUber(array $resume = ['status' => 'challenge_required']): void
    {
        Http::fake([
            '*/login/start' => Http::response(['status' => 'challenge_required', 'login_id' => self::LOGIN_ID, 'challenge' => 'arkose', 'expires_at' => now()->addMinutes(10)->toIso8601String()]),
            '*/login/resume' => Http::response($resume),
            '*/cobrowse/close' => Http::response(['status' => 'closed', 'stream_closed' => true]),
            '*/login/cancel' => Http::response(['status' => 'cancelled']),
        ]);
    }

    private function start(): TestResponse
    {
        return $this->postJson('/api/v1/uber-login/start', ['email' => 'ops@acme.de']);
    }

    private function poll(): TestResponse
    {
        return $this->getJson('/api/v1/uber-login/status');
    }

    public function test_start_asks_for_cobrowse_and_parks_in_awaiting_challenge_without_leaking_the_login_id(): void
    {
        $this->fakeUber();

        $res = $this->start()->assertStatus(202)
            ->assertJsonPath('data.state', 'awaiting_challenge')
            ->assertJsonPath('data.challenge', 'arkose')
            ->assertJsonPath('data.cobrowse_available', true)
            ->assertJsonMissingPath('data.login_id');
        $this->assertStringNotContainsString(self::LOGIN_ID, $res->getContent());
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/start') && $r['cobrowse'] === true);
    }

    public function test_a_manual_connect_clears_an_admin_stop_block(): void
    {
        $this->fakeUber();
        $this->manager->tenant->blockAutolink();

        $this->start()->assertStatus(202);

        $this->assertFalse($this->manager->tenant->fresh()->isAutolinkBlocked());
    }

    public function test_start_does_not_ask_for_cobrowse_when_the_company_flag_is_off(): void
    {
        $other = $this->makeTenant('Plain', false);
        Sanctum::actingAs($this->makeUser($other, 'fleet_manager', 'm@plain.de'));
        SessionBrowser::create(['tenant_id' => $other->id, 'state' => 'needs_otp', 'last_seen_at' => now()]);
        Http::fake(['*/login/start' => Http::response(['status' => 'blocked', 'message' => 'arkose'])]);

        $this->start()->assertOk()->assertJsonPath('data.failure', 'blocked');
        Http::assertSent(fn (HttpRequest $r) => ! isset($r['cobrowse']));
    }

    public function test_ticket_is_minted_for_the_challenge_and_verifies_with_the_contract(): void
    {
        $this->fakeUber();
        $this->start();

        $res = $this->postJson('/api/v1/uber-login/cobrowse')->assertCreated()
            ->assertJsonPath('data.ws_url', 'wss://reidey.test/cobrowse/ws')
            ->assertJsonPath('data.session_ttl', 480)
            ->assertJsonStructure(['data' => ['ws_url', 'ticket', 'expires_at', 'viewport' => ['w', 'h'], 'session_ttl']]);
        $this->assertStringNotContainsString(self::LOGIN_ID, $res->getContent());

        $payload = app(CobrowseTicketSigner::class)->verify($res->json('data.ticket'));
        $this->assertSame((string) $this->tenant->id, $payload['tid']);
        $this->assertSame(substr(hash('sha256', self::LOGIN_ID), 0, 16), $payload['lh']);
        $this->assertSame($this->manager->id, $payload['uid']);
        $this->assertLessThanOrEqual(60, $payload['exp'] - time());
        $this->assertSame(1, AuditLog::where('action', 'cobrowse.ticket_minted')->count());
    }

    public function test_409_outside_a_challenge_and_no_uber_call(): void
    {
        Http::fake();

        $this->postJson('/api/v1/uber-login/cobrowse')->assertStatus(409);
        Http::assertNothingSent();
    }

    public function test_the_viewer_can_reconnect_but_a_third_party_cannot_exceed_the_cap(): void
    {
        $this->fakeUber();
        $this->start();

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/uber-login/cobrowse')->assertCreated();
        }
        // The route throttle (3/hour) answers first; either way a fourth ticket is refused.
        $this->postJson('/api/v1/uber-login/cobrowse')->assertStatus(429);
    }

    public function test_the_per_attempt_ticket_cap_is_too_many_even_without_the_route_throttle(): void
    {
        $this->fakeUber();
        $this->start();
        $service = app(PasswordlessLoginService::class);
        for ($i = 0; $i < 3; $i++) {
            $this->assertArrayHasKey('ticket', $service->mintCobrowseTicket($this->tenant, $this->manager->id));
        }

        $this->assertSame(['error' => 'too_many'], $service->mintCobrowseTicket($this->tenant, $this->manager->id));
    }

    public function test_status_keeps_waiting_while_uber_auth_still_has_the_puzzle_open(): void
    {
        $this->fakeUber();
        $this->start();

        $this->poll()->assertOk()
            ->assertJsonPath('data.state', 'awaiting_challenge')
            ->assertJsonPath('data.cobrowse_available', true);
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/resume')
            && $r['login_id'] === self::LOGIN_ID && $r['company_key'] === (string) $this->tenant->id);
    }

    public function test_solving_the_puzzle_returns_to_the_code_flow_with_a_fresh_code_window(): void
    {
        $this->fakeUber(['status' => 'mfa_required', 'login_id' => self::LOGIN_ID, 'channel' => 'email']);
        $this->start();

        $res = $this->poll()->assertOk()
            ->assertJsonPath('data.state', 'awaiting_code')
            ->assertJsonPath('data.channel', 'email')
            ->assertJsonMissingPath('data.challenge');
        $this->assertStringNotContainsString(self::LOGIN_ID, $res->getContent());
        $this->assertEqualsWithDelta(290, now()->diffInSeconds($res->json('data.expires_at'), false), 5);
        // And a ticket is no longer possible.
        $this->postJson('/api/v1/uber-login/cobrowse')->assertStatus(409);
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function failures(): array
    {
        return [
            'timeout' => [['status' => 'challenge_timeout'], 'challenge_timeout'],
            'failed' => [['status' => 'challenge_failed'], 'challenge_failed'],
            'blocked' => [['status' => 'blocked', 'message' => 'x'], 'blocked'],
            'gone' => [['message' => 'unknown or expired login_id'], 'challenge_timeout'],
            'down' => [['status' => 'error', 'message' => 'browser_service_unreachable'], 'cobrowse_unavailable'],
        ];
    }

    /** @dataProvider failures */
    #[DataProvider('failures')]
    public function test_resume_failures_map_to_the_documented_failures(array $answer, string $failure): void
    {
        $this->fakeUber($answer);
        $this->start();

        $this->poll()->assertOk()->assertJsonPath('data.state', 'failed')->assertJsonPath('data.failure', $failure);
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/cancel'));
    }

    public function test_delete_closes_the_stream_abandons_the_login_and_goes_idle(): void
    {
        $this->fakeUber();
        $this->start();

        $this->deleteJson('/api/v1/uber-login/cobrowse')->assertOk()->assertJsonPath('data.state', 'idle');

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/cobrowse/close') && $r['login_id'] === self::LOGIN_ID && $r['company_key'] === (string) $this->tenant->id);
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/cancel'));
        $this->poll()->assertJsonPath('data.state', 'idle');
    }

    public function test_routes_are_404_when_the_global_or_company_cobrowse_flag_is_off(): void
    {
        Http::fake();
        config(['services.passwordless_login.cobrowse' => false]);
        $this->postJson('/api/v1/uber-login/cobrowse')->assertNotFound();
        $this->deleteJson('/api/v1/uber-login/cobrowse')->assertNotFound();

        config(['services.passwordless_login.cobrowse' => true]);
        $this->tenant->setCobrowseEnabled(false);
        $this->manager->unsetRelation('tenant');
        $this->postJson('/api/v1/uber-login/cobrowse')->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_connections_manage_is_required(): void
    {
        Sanctum::actingAs($this->makeUser($this->tenant, 'viewer', 'v@acme.de'));
        Http::fake();

        $this->postJson('/api/v1/uber-login/cobrowse')->assertForbidden();
        $this->deleteJson('/api/v1/uber-login/cobrowse')->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_a_company_cannot_open_or_close_another_companys_challenge(): void
    {
        $this->fakeUber();
        $this->start();

        $other = $this->makeTenant('Other', true);
        Sanctum::actingAs($this->makeUser($other, 'fleet_manager', 'm@other.de'));
        app(TenantContext::class)->set($other->id);

        $this->postJson('/api/v1/uber-login/cobrowse')->assertStatus(409);
        $this->deleteJson('/api/v1/uber-login/cobrowse')->assertOk()->assertJsonPath('data.state', 'idle');
        Http::assertNotSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/cobrowse/close'));

        // The first company's puzzle is untouched.
        Sanctum::actingAs($this->manager);
        app(TenantContext::class)->set($this->tenant->id);
        $this->poll()->assertJsonPath('data.state', 'awaiting_challenge');
    }

    public function test_no_proxy_means_cobrowse_is_unavailable_with_503(): void
    {
        $this->fakeUber();
        $this->start();
        $this->tenant->forceFill(['proxy_url' => null])->save();
        $this->manager->unsetRelation('tenant');

        $this->postJson('/api/v1/uber-login/cobrowse')->assertStatus(503)->assertJsonPath('error', 'cobrowse_unavailable');
        $this->poll()->assertJsonPath('data.cobrowse_available', false);
    }

    public function test_an_unattended_login_never_asks_for_cobrowse(): void
    {
        Http::fake(['*/login/start' => Http::response(['status' => 'blocked', 'message' => 'arkose'])]);

        app(PasswordlessLoginService::class)->start($this->tenant, 'ops@acme.de', 'auto', interactive: false);

        Http::assertSent(fn (HttpRequest $r) => ! isset($r['cobrowse']));
    }
}
